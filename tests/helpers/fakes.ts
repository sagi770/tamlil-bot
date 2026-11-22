// Shared test fakes for Tasks 11-13.
//
// FakeTelegram and FakeSoniox implement the full TelegramClient / SonioxGateway interfaces.
// Every call is recorded in `.calls` as { method, args } (args exactly as passed), even when
// the method's behaviour is overridden or rejects.
//
// Override a method's behaviour per test by assigning to `.handlers` (the call is still recorded):
//   tg.handlers.sendMessage = async () => ({ message_id: 7 });
//   tg.handlers.sendDocument = () => Promise.reject(new Error('boom'));
//   soniox.handlers.getJob = async () => ({ id: 'job-1', status: 'completed', durationMs: 1000, ref: null, isLink: false });
// A handler receives the same arguments as the real method. Handlers can also be passed to the
// constructors: new FakeTelegram({ sendMessage: ... }).
import type { Deps } from '../../src/deliver.js';
import { loadConfig } from '../../src/config.js';
import { getStrings } from '../../src/strings/index.js';
import type { TelegramClient } from '../../src/telegram.js';
import type { SonioxGateway } from '../../src/soniox.js';

export interface RecordedCall {
  method: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any[];
}

type Handlers<T> = { [K in keyof T]?: T[K] };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

abstract class Recorder<T extends object> {
  readonly calls: RecordedCall[] = [];
  handlers: Handlers<T>;

  constructor(handlers: Handlers<T> = {}) {
    this.handlers = handlers;
  }

  protected run<K extends keyof T>(method: K, args: unknown[], fallback: () => unknown): never {
    this.calls.push({ method: String(method), args });
    const handler = this.handlers[method] as AnyFn | undefined;
    return (handler ? handler(...args) : fallback()) as never;
  }
}

export class FakeTelegram extends Recorder<TelegramClient> implements TelegramClient {
  private nextId = 100;

  sendMessage: TelegramClient['sendMessage'] = async (...args) =>
    this.run('sendMessage', args, () => ({ message_id: this.nextId++ }));
  sendDocument: TelegramClient['sendDocument'] = async (...args) =>
    this.run('sendDocument', args, () => ({ message_id: this.nextId++ }));
  deleteMessage: TelegramClient['deleteMessage'] = async (...args) =>
    this.run('deleteMessage', args, () => undefined);
  removeKeyboard: TelegramClient['removeKeyboard'] = async (...args) =>
    this.run('removeKeyboard', args, () => undefined);
  answerCallbackQuery: TelegramClient['answerCallbackQuery'] = async (...args) =>
    this.run('answerCallbackQuery', args, () => undefined);
  getFileStream: TelegramClient['getFileStream'] = async (...args) =>
    this.run('getFileStream', args, () => new ReadableStream<Uint8Array>({ start: (c) => c.close() }));
  downloadText: TelegramClient['downloadText'] = async (...args) => this.run('downloadText', args, () => '');
}

export class FakeSoniox extends Recorder<SonioxGateway> implements SonioxGateway {
  startFromFile: SonioxGateway['startFromFile'] = async (...args) =>
    this.run('startFromFile', args, () => ({ id: 'job-1' }));
  startFromUrl: SonioxGateway['startFromUrl'] = async (...args) =>
    this.run('startFromUrl', args, () => ({ id: 'job-1' }));
  getJob: SonioxGateway['getJob'] = async (...args) => this.run('getJob', args, () => null);
  getTokens: SonioxGateway['getTokens'] = async (...args) => this.run('getTokens', args, () => []);
  destroy: SonioxGateway['destroy'] = async (...args) => this.run('destroy', args, () => undefined);
  countLeftovers: SonioxGateway['countLeftovers'] = async (...args) =>
    this.run('countLeftovers', args, () => ({ transcriptions: 0, files: 0 }));
}

const REQUIRED_ENV = {
  TELEGRAM_BOT_TOKEN: 'test-telegram-token',
  SONIOX_API_KEY: 'test-soniox-key',
  TELEGRAM_WEBHOOK_SECRET: 'test-telegram-secret',
  SONIOX_WEBHOOK_SECRET: 'test-soniox-secret',
};

export function makeDeps(overrides: Partial<Deps> & { env?: Record<string, string> } = {}): {
  deps: Deps;
  tg: FakeTelegram;
  soniox: FakeSoniox;
} {
  const { env, ...rest } = overrides;
  const tg = new FakeTelegram();
  const soniox = new FakeSoniox();
  const config = loadConfig({ ...REQUIRED_ENV, ...env });
  const deps: Deps = {
    tg,
    soniox,
    summarizer: null,
    config,
    s: getStrings('he'),
    log: { info: vi.fn(), error: vi.fn() },
    now: undefined,
    ...rest,
  };
  return { deps, tg, soniox };
}
