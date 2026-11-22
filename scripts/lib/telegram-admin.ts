import { TelegramApiError } from '../../src/telegram.js';
import type { TgUpdate } from '../../src/telegram-types.js';

// Setup-only Bot API methods. Same error hygiene as src/telegram.ts: an error names the
// method and Telegram's description, never the URL (it contains the token).

export interface WebhookInfo {
  url: string;
  pending_update_count: number;
  last_error_message?: string;
  last_error_date?: number;
}

/** The request never got an answer (offline, DNS, aborted). Not an answer from Telegram. */
export class TelegramNetworkError extends Error {
  constructor(method: string) {
    super(`Telegram ${method} request failed`);
    this.name = 'TelegramNetworkError';
  }
}

export interface TelegramAdmin {
  getMe(signal?: AbortSignal): Promise<{ id: number; username: string }>;
  getWebhookInfo(signal?: AbortSignal): Promise<WebhookInfo>;
  /** Registers the webhook for messages and button presses, with the secret Telegram sends back. */
  setWebhook(input: { url: string; secret: string }): Promise<void>;
  /** Removes the webhook and keeps pending updates, so getUpdates can read them. */
  deleteWebhook(): Promise<void>;
  /** `signal` aborts the in-flight request (dev mode uses it to stop a long poll on Ctrl+C). */
  getUpdates(input?: { offset?: number; timeoutSec?: number; signal?: AbortSignal }): Promise<TgUpdate[]>;
  setMyCommands(commands: { command: string; description: string }[]): Promise<void>;
}

interface Envelope {
  ok?: boolean;
  result?: unknown;
  error_code?: number;
  description?: string;
}

export function createTelegramAdmin(token: string, fetchImpl: typeof fetch = fetch): TelegramAdmin {
  const apiBase = `https://api.telegram.org/bot${token}`;

  async function call<T>(method: string, payload: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
    let response: Response;
    try {
      response = await fetchImpl(`${apiBase}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        ...(signal ? { signal } : {}),
      });
    } catch {
      throw new TelegramNetworkError(method);
    }
    let envelope: Envelope | null;
    try {
      envelope = (await response.json()) as Envelope | null;
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

  return {
    async getMe(signal) {
      const me = await call<{ id: number; username?: string }>('getMe', {}, signal);
      return { id: me.id, username: me.username ?? '' };
    },

    async getWebhookInfo(signal) {
      const info = await call<Partial<WebhookInfo>>('getWebhookInfo', {}, signal);
      return {
        url: info.url ?? '',
        pending_update_count: info.pending_update_count ?? 0,
        ...(info.last_error_message ? { last_error_message: info.last_error_message } : {}),
        ...(info.last_error_date ? { last_error_date: info.last_error_date } : {}),
      };
    },

    async setWebhook({ url, secret }) {
      await call('setWebhook', { url, secret_token: secret, allowed_updates: ['message', 'callback_query'] });
    },

    async deleteWebhook() {
      await call('deleteWebhook', { drop_pending_updates: false });
    },

    async getUpdates(input = {}) {
      return call<TgUpdate[]>(
        'getUpdates',
        {
          ...(input.offset === undefined ? {} : { offset: input.offset }),
          timeout: input.timeoutSec ?? 0,
        },
        input.signal,
      );
    },

    async setMyCommands(commands) {
      await call('setMyCommands', { commands });
    },
  };
}
