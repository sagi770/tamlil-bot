import { accessMode } from './access.js';
import type { Config } from './config.js';
import { MESSAGE_TEXT_LIMIT, countSpeakers, formatFooter, formatTranscriptFile, formatTranscriptMessage } from './format.js';
import type { Logger } from './log.js';
import type { SonioxGateway } from './soniox.js';
import type { Strings } from './strings/index.js';
import type { Summarizer } from './summarize.js';
import type { TelegramClient } from './telegram.js';
import type { SegmentDraft } from './types.js';

export interface Deps {
  tg: TelegramClient;
  soniox: SonioxGateway;
  summarizer: Summarizer | null;
  config: Config;
  s: Strings;
  log: Logger;
  now?: () => Date;
  afterStart?: (jobId: string) => void; // dev mode only
}

export const SUMMARY_CALLBACK = 'sum';

export async function deliverTranscript(
  deps: Deps,
  input: { chatId: number; replyTo: number; segments: SegmentDraft[]; durationMs: number | null },
): Promise<{ transcriptText: string; messageId: number }> {
  const { chatId, replyTo, segments, durationMs } = input;
  // Telegram rejects blank messages; callers send `noSpeech` instead.
  if (segments.length === 0) throw new Error('deliverTranscript requires at least one segment');

  const footer = formatFooter(durationMs, countSpeakers(segments), deps.s);
  const keyboard = deps.summarizer
    ? [[{ text: deps.s.summarizeButton, callback_data: SUMMARY_CALLBACK }]]
    : undefined;

  const text = formatTranscriptMessage(segments, deps.s);
  const withFooter = `${text}\n\n${footer}`;
  if (withFooter.length <= MESSAGE_TEXT_LIMIT) {
    const sent = await deps.tg.sendMessage(chatId, withFooter, { replyTo, keyboard });
    return { transcriptText: text, messageId: sent.message_id };
  }

  const content = formatTranscriptFile(segments, deps.s);
  const name = deps.s.transcriptFileName(deps.now?.() ?? new Date(), deps.config.timeZone);
  const sent = await deps.tg.sendDocument(chatId, { name, content }, { replyTo, keyboard, caption: footer });
  return { transcriptText: content, messageId: sent.message_id };
}

export async function deliverSummary(
  deps: Deps,
  input: { chatId: number; replyTo: number; transcript: string },
): Promise<boolean> {
  if (!deps.summarizer) return false;
  const { chatId, replyTo, transcript } = input;

  let result: { text: string; truncated: boolean };
  try {
    result = await deps.summarizer.summarize(transcript);
  } catch (e) {
    // Class name only: the message may echo transcript text or secrets.
    deps.log.error('summary_failed', { error: e instanceof Error ? e.constructor.name : typeof e });
    await deps.tg.sendMessage(chatId, deps.s.summaryFailed, { replyTo });
    return false;
  }

  const body = `${deps.s.summaryHeader}\n\n${result.text}`;
  await deps.tg.sendMessage(chatId, result.truncated ? `${body}\n\n${deps.s.summaryTruncated}` : body, { replyTo });
  return true;
}

export async function sendOpenWarningIfNeeded(deps: Deps, chatId: number, userId: number): Promise<void> {
  if (accessMode(deps.config) !== 'open-warn') return;
  await deps.tg.sendMessage(chatId, deps.s.openWarning(userId));
}
