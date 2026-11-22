import { ConfigError, loadConfig } from '../src/config.js';
import { createSonioxHandler, createTelegramHandler } from '../src/http.js';
import { encodeRef } from '../src/reference.js';
import type { SonioxToken } from '../src/types.js';
import { makeDeps } from './helpers/fakes.js';

const waitUntil = vi.fn();
beforeEach(() => waitUntil.mockClear());

const TG_HEADER = 'x-telegram-bot-api-secret-token';
const SX_HEADER = 'x-tamlil-bot-secret';
const tgReq = (headers: Record<string, string>, body: string, method = 'POST') =>
  new Request('https://x/api/telegram', { method, headers, body: method === 'POST' ? body : undefined });
const sxReq = (headers: Record<string, string>, body: string, method = 'POST') =>
  new Request('https://x/api/soniox', { method, headers, body: method === 'POST' ? body : undefined });

const oneToken = [{ text: 'hi', start_ms: 0, end_ms: 100, confidence: 1, speaker: '1', language: 'en' }];
const ref = (mode: 't' | 's') => encodeRef({ chatId: 5, replyTo: 6, statusMessageId: 7, mode });
/** Deps whose config was loaded without webhook secrets (both are ''). */
const depsWithoutSecrets = () =>
  makeDeps({ config: loadConfig({ TELEGRAM_BOT_TOKEN: 't', SONIOX_API_KEY: 's' }, { requireWebhookSecrets: false }) });

describe('webhook secrets', () => {
  it('rejects every request when no secret is configured, even with an empty header', async () => {
    const { deps, tg, soniox } = depsWithoutSecrets();
    expect(deps.config.telegramWebhookSecret).toBe('');
    expect(deps.config.sonioxWebhookSecret).toBe('');
    const tgH = createTelegramHandler(() => deps, waitUntil);
    const sxH = createSonioxHandler(() => deps, waitUntil);
    expect((await tgH(tgReq({ [TG_HEADER]: '' }, '{"update_id":1}'))).status).toBe(401);
    expect((await sxH(sxReq({ [SX_HEADER]: '' }, '{"id":"j","status":"completed"}'))).status).toBe(401);
    expect(waitUntil).not.toHaveBeenCalled();
    expect(tg.calls).toEqual([]);
    expect(soniox.calls).toEqual([]);
  });
});

describe('createTelegramHandler', () => {
  it('rejects a missing or wrong Telegram secret with 401 and does no work', async () => {
    const { deps, tg } = makeDeps();
    const h = createTelegramHandler(() => deps, waitUntil);
    expect((await h(tgReq({}, '{"update_id":1}'))).status).toBe(401);
    expect((await h(tgReq({ [TG_HEADER]: 'wrong' }, '{"update_id":1}'))).status).toBe(401);
    expect(waitUntil).not.toHaveBeenCalled();
    expect(tg.calls).toEqual([]);
  });

  it('answers 200 at once and hands the work to waitUntil', async () => {
    const { deps } = makeDeps();
    const h = createTelegramHandler(() => deps, waitUntil);
    const r = await h(tgReq({ [TG_HEADER]: deps.config.telegramWebhookSecret }, '{"update_id":1}'));
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('ok');
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0]?.[0];
  });

  describe('Soniox webhook host', () => {
    const voiceUpdate = JSON.stringify({
      update_id: 1,
      message: { message_id: 10, date: 1, chat: { id: 5, type: 'private' }, from: { id: 1 }, voice: { file_id: 'v' } },
    });
    const run = async (url: string) => {
      const { deps, soniox } = makeDeps();
      const h = createTelegramHandler(() => deps, waitUntil);
      const r = await h(new Request(url, { method: 'POST', headers: { [TG_HEADER]: deps.config.telegramWebhookSecret }, body: voiceUpdate }));
      expect(r.status).toBe(200);
      await waitUntil.mock.calls[0]?.[0];
      return soniox.calls.find((c) => c.method === 'startFromFile')?.args[0];
    };

    it('passes the https origin Telegram called to startFromFile', async () => {
      expect((await run('https://tamlil-bot-abc.vercel.app/api/telegram'))?.webhookBase).toBe('https://tamlil-bot-abc.vercel.app');
    });
    it('ignores an http origin', async () => {
      const input = await run('http://tamlil-bot-abc.vercel.app/api/telegram');
      expect(input).toBeDefined();
      expect(input?.webhookBase).toBeUndefined();
    });
  });

  it('answers 405 to GET and 400 to a non-JSON body', async () => {
    const { deps } = makeDeps();
    const h = createTelegramHandler(() => deps, waitUntil);
    expect((await h(tgReq({}, '', 'GET'))).status).toBe(405);
    expect((await h(tgReq({ [TG_HEADER]: deps.config.telegramWebhookSecret }, 'nope'))).status).toBe(400);
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it.each(['[]', 'null', '{"update_id":"1"}', '{}', '42'])('answers 400 to the body %s', async (body) => {
    const { deps } = makeDeps();
    const h = createTelegramHandler(() => deps, waitUntil);
    expect((await h(tgReq({ [TG_HEADER]: deps.config.telegramWebhookSecret }, body))).status).toBe(400);
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it('answers 405 before touching configuration', async () => {
    const getDeps = vi.fn(() => makeDeps().deps);
    const h = createTelegramHandler(getDeps, waitUntil);
    expect((await h(tgReq({}, '', 'GET'))).status).toBe(405);
    expect(getDeps).not.toHaveBeenCalled();
  });

  it('answers 500 when configuration is missing, naming the variables only in the log', async () => {
    const log = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const h = createTelegramHandler(() => {
        throw new ConfigError(['SONIOX_API_KEY']);
      }, waitUntil);
      const r = await h(tgReq({}, '{}'));
      expect(r.status).toBe(500);
      expect(await r.text()).not.toContain('SONIOX_API_KEY');
      const logged = log.mock.calls.map((c) => String(c[0])).join('');
      expect(logged).toContain('config_error');
      expect(logged).toContain('SONIOX_API_KEY');
    } finally {
      log.mockRestore();
    }
  });

  it('answers 500 with a generic body when getDeps throws something else', async () => {
    const log = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const h = createTelegramHandler(() => {
        throw new Error('secret-detail');
      }, waitUntil);
      const r = await h(tgReq({}, '{}'));
      expect(r.status).toBe(500);
      expect(await r.text()).not.toContain('secret-detail');
      expect(log.mock.calls.map((c) => String(c[0])).join('')).not.toContain('secret-detail');
    } finally {
      log.mockRestore();
    }
  });
});

describe('createSonioxHandler', () => {
  const body = '{"id":"j","status":"completed"}';

  it('rejects a Soniox webhook without the secret header', async () => {
    const { deps, soniox } = makeDeps();
    const h = createSonioxHandler(() => deps, waitUntil);
    const r = await h(sxReq({}, body));
    expect(r.status).toBe(401);
    expect(soniox.calls).toEqual([]);
  });

  it('rejects a Soniox webhook with a wrong secret', async () => {
    const { deps, soniox } = makeDeps();
    const h = createSonioxHandler(() => deps, waitUntil);
    const r = await h(sxReq({ [SX_HEADER]: 'wrong' }, body));
    expect(r.status).toBe(401);
    expect(soniox.calls).toEqual([]);
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it('answers 500 with the generic body when the event handler throws, logging the class only', async () => {
    const { deps, soniox } = makeDeps();
    soniox.handlers.getJob = async () => ({ id: 'j', status: 'completed', durationMs: 1000, ref: ref('t'), isLink: false });
    soniox.handlers.getTokens = async () => ({}) as unknown as SonioxToken[]; // segment grouping throws a TypeError
    const h = createSonioxHandler(() => deps, waitUntil);
    const r = await h(sxReq({ [SX_HEADER]: deps.config.sonioxWebhookSecret }, body));
    expect(r.status).toBe(500);
    expect(await r.text()).toBe('error');
    expect(vi.mocked(deps.log.error).mock.calls).toEqual([['soniox_event_failed', { error: 'TypeError' }]]);
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it('answers 405 to GET', async () => {
    const { deps } = makeDeps();
    const h = createSonioxHandler(() => deps, waitUntil);
    expect((await h(sxReq({}, '', 'GET'))).status).toBe(405);
  });

  it('answers 500 when configuration is missing', async () => {
    const log = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const h = createSonioxHandler(() => {
        throw new ConfigError(['SONIOX_API_KEY']);
      }, waitUntil);
      const r = await h(sxReq({}, body));
      expect(r.status).toBe(500);
      expect(await r.text()).not.toContain('SONIOX_API_KEY');
    } finally {
      log.mockRestore();
    }
  });

  it('returns the handler status and skips waitUntil when there is no background task', async () => {
    const { deps } = makeDeps(); // FakeSoniox.getJob returns null by default
    const h = createSonioxHandler(() => deps, waitUntil);
    const r = await h(sxReq({ [SX_HEADER]: deps.config.sonioxWebhookSecret }, body));
    expect(r.status).toBe(200);
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it('returns 500 when delivery fails', async () => {
    const { deps, soniox, tg } = makeDeps();
    soniox.handlers.getJob = async () => ({ id: 'j', status: 'completed', durationMs: 1000, ref: ref('t'), isLink: false });
    soniox.handlers.getTokens = async () => oneToken;
    tg.handlers.sendMessage = () => Promise.reject(new Error('boom'));
    const h = createSonioxHandler(() => deps, waitUntil);
    const r = await h(sxReq({ [SX_HEADER]: deps.config.sonioxWebhookSecret }, body));
    expect(r.status).toBe(500);
    expect(await r.text()).toBe('error');
  });

  it('hands the summary background task to waitUntil', async () => {
    const summarizer = { summarize: vi.fn().mockResolvedValue({ text: 'x', truncated: false }) };
    const { deps, soniox } = makeDeps({ summarizer });
    soniox.handlers.getJob = async () => ({ id: 'j', status: 'completed', durationMs: 1000, ref: ref('s'), isLink: false });
    soniox.handlers.getTokens = async () => oneToken;
    const h = createSonioxHandler(() => deps, waitUntil);
    const r = await h(sxReq({ [SX_HEADER]: deps.config.sonioxWebhookSecret }, body));
    expect(r.status).toBe(200);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0]?.[0];
    expect(summarizer.summarize).toHaveBeenCalled();
  });
});
