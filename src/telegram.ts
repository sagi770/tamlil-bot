import type { InlineKeyboard } from './telegram-types.js';

export class TelegramApiError extends Error {
  readonly code: number;
  readonly description: string;
  constructor(code: number, description: string) {
    super(`Telegram API error ${code}: ${description}`);
    this.name = 'TelegramApiError';
    this.code = code;
    this.description = description;
  }
}

export interface SendOpts {
  replyTo?: number;
  keyboard?: InlineKeyboard;
}

export interface TelegramClient {
  sendMessage(chatId: number, text: string, opts?: SendOpts): Promise<{ message_id: number }>;
  sendDocument(
    chatId: number,
    file: { name: string; content: string },
    opts?: SendOpts & { caption?: string },
  ): Promise<{ message_id: number }>;
  deleteMessage(chatId: number, messageId: number): Promise<void>;
  removeKeyboard(chatId: number, messageId: number): Promise<void>;
  answerCallbackQuery(id: string, text?: string): Promise<void>;
  getFileStream(fileId: string): Promise<ReadableStream<Uint8Array>>;
  downloadText(fileId: string): Promise<string>;
}

export const TELEGRAM_MESSAGE_LIMIT = 4096;

function hardSplit(text: string, limit: number): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > limit) {
    let cut = limit;
    const code = rest.charCodeAt(cut);
    // Do not cut between the halves of a surrogate pair.
    if (code >= 0xdc00 && code <= 0xdfff && cut > 1) cut -= 1;
    parts.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) parts.push(rest);
  return parts;
}

function pack(pieces: string[], separator: string, limit: number): string[] {
  const parts: string[] = [];
  let current = '';
  for (const piece of pieces) {
    if (current === '') {
      current = piece;
    } else if (current.length + separator.length + piece.length <= limit) {
      current += separator + piece;
    } else {
      parts.push(current);
      current = piece;
    }
  }
  if (current !== '') parts.push(current);
  return parts;
}

export function splitForTelegram(text: string, limit: number = TELEGRAM_MESSAGE_LIMIT): string[] {
  if (text.trim() === '') return [];
  if (text.length <= limit) return [text];
  const pieces: string[] = [];
  for (const paragraph of text.split('\n\n')) {
    if (paragraph === '') continue;
    if (paragraph.length <= limit) {
      pieces.push(paragraph);
      continue;
    }
    const lines = paragraph.split('\n').flatMap((line) => hardSplit(line, limit));
    pieces.push(...pack(lines.filter((l) => l !== ''), '\n', limit));
  }
  return pack(pieces, '\n\n', limit);
}

interface TelegramEnvelope {
  ok?: boolean;
  result?: unknown;
  error_code?: number;
  description?: string;
}

export function createTelegramClient(token: string, fetchImpl: typeof fetch = fetch): TelegramClient {
  const apiBase = `https://api.telegram.org/bot${token}`;

  async function call<T>(method: string, payload: Record<string, unknown> | FormData): Promise<T> {
    const init: RequestInit =
      payload instanceof FormData
        ? { method: 'POST', body: payload }
        : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) };
    let response: Response;
    try {
      response = await fetchImpl(`${apiBase}/${method}`, init);
    } catch {
      throw new Error(`Telegram ${method} request failed`);
    }
    let envelope: TelegramEnvelope | null;
    try {
      envelope = (await response.json()) as TelegramEnvelope | null;
    } catch {
      throw new Error(`Telegram ${method} returned an invalid response`);
    }
    if (!envelope || envelope.ok !== true) {
      throw new TelegramApiError(
        typeof envelope?.error_code === 'number' ? envelope.error_code : response.status,
        typeof envelope?.description === 'string' ? envelope.description : 'Unknown error',
      );
    }
    return envelope.result as T;
  }

  const replyParameters = (replyTo: number) => ({ message_id: replyTo, allow_sending_without_reply: true });

  async function swallow400(run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (e) {
      if (e instanceof TelegramApiError && e.code === 400) return;
      throw e;
    }
  }

  async function getFileStream(fileId: string): Promise<ReadableStream<Uint8Array>> {
    const info = await call<{ file_path?: string }>('getFile', { file_id: fileId });
    if (!info?.file_path) throw new Error('Telegram getFile returned no file_path');
    let response: Response;
    try {
      response = await fetchImpl(`https://api.telegram.org/file/bot${token}/${info.file_path}`);
    } catch {
      throw new Error('Telegram getFile download failed');
    }
    if (!response.ok || !response.body) {
      try {
        void Promise.resolve(response.body?.cancel()).catch(() => undefined);
      } catch {
        // best effort
      }
      throw new Error('Telegram getFile download failed');
    }
    return response.body;
  }

  return {
    async sendMessage(chatId, text, opts = {}) {
      const parts = splitForTelegram(text);
      if (parts.length === 0) throw new Error('Telegram sendMessage: empty text');
      let last = { message_id: 0 };
      for (let i = 0; i < parts.length; i++) {
        const result = await call<{ message_id: number }>('sendMessage', {
          chat_id: chatId,
          text: parts[i],
          ...(i === 0 && opts.replyTo !== undefined ? { reply_parameters: replyParameters(opts.replyTo) } : {}),
          ...(i === parts.length - 1 && opts.keyboard !== undefined
            ? { reply_markup: { inline_keyboard: opts.keyboard } }
            : {}),
        });
        last = { message_id: result.message_id };
      }
      return last;
    },

    async sendDocument(chatId, file, opts = {}) {
      const form = new FormData();
      form.set('chat_id', String(chatId));
      form.set('document', new File([file.content], file.name, { type: 'text/plain' }));
      if (opts.caption !== undefined) form.set('caption', opts.caption);
      if (opts.replyTo !== undefined) form.set('reply_parameters', JSON.stringify(replyParameters(opts.replyTo)));
      if (opts.keyboard !== undefined) form.set('reply_markup', JSON.stringify({ inline_keyboard: opts.keyboard }));
      const result = await call<{ message_id: number }>('sendDocument', form);
      return { message_id: result.message_id };
    },

    deleteMessage: (chatId, messageId) =>
      swallow400(() => call('deleteMessage', { chat_id: chatId, message_id: messageId })),

    removeKeyboard: (chatId, messageId) =>
      swallow400(() =>
        call('editMessageReplyMarkup', {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: { inline_keyboard: [] },
        }),
      ),

    async answerCallbackQuery(id, text) {
      await call('answerCallbackQuery', { callback_query_id: id, ...(text === undefined ? {} : { text }) });
    },

    getFileStream,

    async downloadText(fileId) {
      const stream = await getFileStream(fileId);
      try {
        return await new Response(stream).text();
      } catch {
        throw new Error('Telegram getFile download failed');
      }
    },
  };
}
