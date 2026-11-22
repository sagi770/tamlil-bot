import { isAllowed } from './access.js';
import { SUMMARY_CALLBACK, deliverSummary, sendOpenWarningIfNeeded } from './deliver.js';
import type { Deps } from './deliver.js';
import { stripFooter } from './format.js';
import { wantsSummary } from './intent.js';
import { preflightMediaUrl } from './media-fetch.js';
import { extractFirstUrl, normalizeMediaUrl, withoutUrls } from './media-url.js';
import { extractMedia, isTooLarge } from './media.js';
import { encodeRef } from './reference.js';
import { SonioxStartError } from './soniox.js';
import { TelegramApiError } from './telegram.js';
import type { TgCallbackQuery, TgMessage, TgUpdate } from './telegram-types.js';
import type { Mode } from './types.js';

export interface HandleUpdateOpts {
  preflight?: typeof preflightMediaUrl;
  /** The https origin Telegram called; Soniox's webhook goes there unless PUBLIC_BASE_URL is set. None in dev mode. */
  webhookBase?: string;
}

function errorName(e: unknown): string {
  return e instanceof Error ? e.constructor.name : typeof e;
}

function failureText(deps: Deps, e: unknown): string {
  if (e instanceof TelegramApiError && /file is too big/i.test(e.description)) return deps.s.tooLarge;
  if (e instanceof SonioxStartError) return e.kind === 'payment' ? deps.s.sonioxPayment : deps.s.sonioxFailed;
  return deps.s.genericError;
}

/** Deletes the status message (best effort), then tells the user what went wrong. */
async function failAfterStatus(deps: Deps, chatId: number, statusMessageId: number, replyTo: number, text: string): Promise<void> {
  try {
    await deps.tg.deleteMessage(chatId, statusMessageId);
  } catch (delErr) {
    deps.log.error('status_delete_failed', { error: errorName(delErr) });
  }
  await deps.tg.sendMessage(chatId, text, { replyTo });
}

function commandOf(text: string | undefined): string | null {
  if (!text?.startsWith('/')) return null;
  const token = text.trim().split(/\s+/)[0] ?? '';
  return token.split('@')[0] ?? null;
}

async function handleCommand(deps: Deps, command: string, chatId: number, userId: number): Promise<boolean> {
  switch (command) {
    case '/start':
      await deps.tg.sendMessage(chatId, deps.s.welcome);
      await sendOpenWarningIfNeeded(deps, chatId, userId);
      return true;
    case '/help':
      await deps.tg.sendMessage(chatId, deps.s.help(deps.summarizer !== null));
      return true;
    case '/id':
      await deps.tg.sendMessage(chatId, deps.s.yourId(userId));
      return true;
    default:
      return false;
  }
}

function summaryMode(deps: Deps, text: string | undefined): Mode {
  return deps.summarizer !== null && wantsSummary(text) ? 's' : 't';
}

/** Dev-mode hook: a throw is logged and never reaches the user, since the job is already running. */
function runAfterStart(deps: Deps, jobId: string): void {
  try {
    deps.afterStart?.(jobId);
  } catch (e) {
    deps.log.error('after_start_failed', { error: errorName(e) });
  }
}

async function handleMedia(
  deps: Deps,
  message: TgMessage,
  media: NonNullable<ReturnType<typeof extractMedia>>,
  webhookBase: string | undefined,
): Promise<void> {
  const chatId = message.chat.id;
  const replyTo = message.message_id;
  if (isTooLarge(media)) {
    await deps.tg.sendMessage(chatId, deps.s.tooLarge, { replyTo });
    return;
  }
  const mode = summaryMode(deps, message.caption);
  const status = await deps.tg.sendMessage(chatId, deps.s.transcribing, { replyTo });
  let jobId: string;
  try {
    const ref = encodeRef({ chatId, replyTo, statusMessageId: status.message_id, mode });
    const stream = await deps.tg.getFileStream(media.fileId);
    jobId = (await deps.soniox.startFromFile({ stream, filename: media.fileName, ref, webhookBase })).id;
  } catch (e) {
    deps.log.error('job_start_failed', { kind: 'file', error: errorName(e) });
    await failAfterStatus(deps, chatId, status.message_id, replyTo, failureText(deps, e));
    return;
  }
  deps.log.info('job_started', { kind: 'file', mode });
  runAfterStart(deps, jobId);
}

async function handleLink(
  deps: Deps,
  message: TgMessage,
  rawUrl: string,
  preflight: typeof preflightMediaUrl,
  webhookBase: string | undefined,
): Promise<void> {
  const chatId = message.chat.id;
  const replyTo = message.message_id;
  const normalized = normalizeMediaUrl(rawUrl);
  if (!normalized.ok) {
    await deps.tg.sendMessage(chatId, deps.s.linkRejected(normalized.reason), { replyTo });
    return;
  }
  // A link alone never asks for a paid summary, whatever its file name says.
  const mode = summaryMode(deps, withoutUrls(message.text));
  const status = await deps.tg.sendMessage(chatId, deps.s.transcribing, { replyTo });
  // Only the error text is decided inside the try; the reply happens once, outside it.
  let started: { jobId: string } | { failure: string };
  try {
    const check = await preflight(normalized.url);
    if (check.ok) {
      const ref = encodeRef({ chatId, replyTo, statusMessageId: status.message_id, mode });
      started = { jobId: (await deps.soniox.startFromUrl({ url: check.finalUrl, ref, webhookBase })).id };
    } else {
      started = { failure: check.reason === 'not-media' ? deps.s.linkNotMedia : deps.s.linkFetchFailed };
    }
  } catch (e) {
    deps.log.error('job_start_failed', { kind: 'link', error: errorName(e) });
    started = { failure: failureText(deps, e) };
  }
  if ('failure' in started) {
    await failAfterStatus(deps, chatId, status.message_id, replyTo, started.failure);
    return;
  }
  deps.log.info('job_started', { kind: 'link', mode });
  runAfterStart(deps, started.jobId);
}

async function handleMessage(deps: Deps, message: TgMessage, opts: HandleUpdateOpts): Promise<void> {
  if (message.chat.type !== 'private') return;
  if (!message.from) return;
  const chatId = message.chat.id;
  const userId = message.from.id;

  if (!isAllowed(deps.config, userId)) {
    deps.log.info('access_denied', { kind: 'message' });
    await deps.tg.sendMessage(chatId, deps.s.notAllowed(userId), { replyTo: message.message_id });
    return;
  }

  const command = commandOf(message.text);
  if (command !== null && (await handleCommand(deps, command, chatId, userId))) return;

  const media = extractMedia(message);
  if (media) {
    await handleMedia(deps, message, media, opts.webhookBase);
    return;
  }

  const url = extractFirstUrl(message.text);
  if (url) {
    await handleLink(deps, message, url, opts.preflight ?? preflightMediaUrl, opts.webhookBase);
    return;
  }

  await deps.tg.sendMessage(chatId, deps.s.unsupported, { replyTo: message.message_id });
}

/**
 * Best effort: only stops the button's spinner. Telegram refuses an answer that comes too late
 * (400 "query is too old", e.g. after a delayed delivery); that must not stop the summary.
 */
async function answerCallback(deps: Deps, ...args: Parameters<Deps['tg']['answerCallbackQuery']>): Promise<void> {
  try {
    await deps.tg.answerCallbackQuery(...args);
  } catch (e) {
    deps.log.error('callback_answer_failed', { error: errorName(e) });
  }
}

async function handleCallback(deps: Deps, query: TgCallbackQuery): Promise<void> {
  const { message } = query;
  const outsidePrivate = message !== undefined && message.date !== 0 && message.chat.type !== 'private';
  const denied = !isAllowed(deps.config, query.from.id);
  if (denied) deps.log.info('access_denied', { kind: 'callback' });
  if (outsidePrivate || query.data !== SUMMARY_CALLBACK || deps.summarizer === null || denied) {
    await answerCallback(deps, query.id);
    return;
  }
  await answerCallback(deps, query.id, deps.s.summarizing);

  if (!message || message.date === 0) {
    await deps.tg.sendMessage(query.from.id, deps.s.messageTooOld);
    return;
  }

  // Downloaded file content has no footer, so stripping is only for message text.
  const source = message.document
    ? await deps.tg.downloadText(message.document.file_id)
    : stripFooter(message.text ?? '');
  const chatId = message.chat.id;
  if (source.trim() === '') {
    await deps.tg.sendMessage(chatId, deps.s.messageTooOld, { replyTo: message.message_id });
    return;
  }

  const delivered = await deliverSummary(deps, { chatId, replyTo: message.message_id, transcript: source });
  if (delivered) await deps.tg.removeKeyboard(chatId, message.message_id);
}

/**
 * Where the generic error may go after a failure: a private chat of a user who passed the access
 * check, or null. The update may be malformed (that may be why it failed), so this never throws.
 */
function replyTarget(deps: Deps, update: TgUpdate | null | undefined): number | null {
  try {
    const message = update?.message;
    if (message) {
      const userId = message.from?.id;
      if (message.chat?.type !== 'private' || typeof userId !== 'number' || !isAllowed(deps.config, userId)) return null;
      const chatId = message.chat.id;
      return typeof chatId === 'number' ? chatId : null;
    }
    const query = update?.callback_query;
    const userId = query?.from?.id;
    if (typeof userId !== 'number' || !isAllowed(deps.config, userId)) return null;
    const source = query?.message;
    // An inaccessible (date 0) or missing message: the user's own private chat, as handleCallback does.
    if (!source || source.date === 0) return userId;
    const chatId = source.chat?.id;
    return source.chat?.type === 'private' && typeof chatId === 'number' ? chatId : null;
  } catch {
    return null;
  }
}

/** Routes one Telegram update. Runs after the webhook answered 200, so it never throws. */
export async function handleUpdate(deps: Deps, update: TgUpdate, opts: HandleUpdateOpts = {}): Promise<void> {
  try {
    if (update.message) await handleMessage(deps, update.message, opts);
    else if (update.callback_query) await handleCallback(deps, update.callback_query);
  } catch (e) {
    deps.log.error('update_failed', { error: errorName(e) });
    const chatId = replyTarget(deps, update);
    if (chatId === null) return;
    try {
      await deps.tg.sendMessage(chatId, deps.s.genericError);
    } catch (replyErr) {
      deps.log.error('update_reply_failed', { error: errorName(replyErr) });
    }
  }
}
