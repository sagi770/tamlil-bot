import { createHttpError } from '@soniox/node';
import type { SonioxNodeClient } from '@soniox/node';
import { loadConfig } from '../src/config.js';
import { createSonioxGateway, SonioxStartError, verifySonioxWebhook } from '../src/soniox.js';

const base = { TELEGRAM_BOT_TOKEN: 't', SONIOX_API_KEY: 's', TELEGRAM_WEBHOOK_SECRET: 'a', SONIOX_WEBHOOK_SECRET: 'b' };
const config = { ...loadConfig(base), publicBaseUrl: 'https://x.vercel.app' };

interface FakeOpts {
  uploadId?: string;
  uploadError?: unknown;
  createId?: string;
  createError?: unknown;
  job?: Record<string, unknown> | null;
  tokens?: Array<Record<string, unknown>>;
  destroyStatus?: number;
  fileCount?: number;
  jobCount?: number;
}

const httpError = (status: number) => createHttpError('https://api.soniox.com/x', 'POST', status, {}, 'secret-body');

/** Mimics the SDK list result: async-iterable across pages. */
function paged<T>(items: T[], pageSize = 2) {
  return {
    async *[Symbol.asyncIterator]() {
      for (let i = 0; i < items.length; i += pageSize) yield* items.slice(i, i + pageSize);
    },
  };
}

function fakeClient(o: FakeOpts = {}) {
  const calls = { create: [] as Record<string, unknown>[], upload: [] as unknown[], fileDelete: [] as string[] };
  const client = {
    files: {
      upload: async (stream: unknown, opts: unknown) => {
        calls.upload.push({ stream, opts });
        if (o.uploadError) throw o.uploadError;
        return { id: o.uploadId ?? 'f' };
      },
      delete: async (id: string) => {
        calls.fileDelete.push(id);
      },
      list: async () => paged(Array.from({ length: o.fileCount ?? 0 }, (_, i) => ({ id: `f${i}` }))),
    },
    stt: {
      create: async (opts: Record<string, unknown>) => {
        calls.create.push(opts);
        if (o.createError) throw o.createError;
        return { id: o.createId ?? 'j' };
      },
      get: async () => (o.job === undefined ? null : o.job),
      getTranscript: async () => (o.tokens ? { tokens: o.tokens } : null),
      destroy: async () => {
        if (o.destroyStatus) throw httpError(o.destroyStatus);
      },
      list: async () => paged(Array.from({ length: o.jobCount ?? 0 }, (_, i) => ({ id: `j${i}` }))),
    },
  } as unknown as SonioxNodeClient;
  return { client, calls };
}

const input = () => ({ stream: new ReadableStream<Uint8Array>(), filename: 'a.ogg', ref: 'v1|1|2|3|t' });

describe('gateway start', () => {
  it('uploads then creates a job with webhook, reference and defaults', async () => {
    const { client, calls } = fakeClient({ uploadId: 'file-1', createId: 'job-1' });
    const gw = createSonioxGateway(config, client);
    expect(await gw.startFromFile(input())).toEqual({ id: 'job-1' });
    expect(calls.upload[0]).toMatchObject({ opts: { filename: 'a.ogg' } });
    expect(calls.create[0]).toMatchObject({
      model: 'stt-async-v5',
      file_id: 'file-1',
      language_hints: ['he', 'en'],
      enable_speaker_diarization: true,
      enable_language_identification: true,
      client_reference_id: 'v1|1|2|3|t',
      webhook_url: 'https://x.vercel.app/api/soniox',
      webhook_auth_header_name: 'x-tamlil-bot-secret',
      webhook_auth_header_value: config.sonioxWebhookSecret,
    });
    expect(calls.create[0]).not.toHaveProperty('context');
    expect(String(calls.create[0]?.webhook_url)).not.toContain('?');
  });
  it('omits webhook fields when there is no public URL', async () => {
    const { client, calls } = fakeClient({ uploadId: 'f', createId: 'j' });
    await createSonioxGateway({ ...config, publicBaseUrl: null }, client).startFromFile(input());
    expect(calls.create[0]).not.toHaveProperty('webhook_url');
    expect(calls.create[0]).not.toHaveProperty('webhook_auth_header_name');
    expect(calls.create[0]).not.toHaveProperty('webhook_auth_header_value');
  });
  it('sends the webhook to the host Telegram called, ahead of VERCEL_PROJECT_PRODUCTION_URL', async () => {
    const prod = loadConfig({ ...base, VERCEL_PROJECT_PRODUCTION_URL: 'tamlil-bot.vercel.app' });
    const a = fakeClient({ uploadId: 'f', createId: 'j' });
    await createSonioxGateway(prod, a.client).startFromFile({ ...input(), webhookBase: 'https://tamlil-bot-abc.vercel.app' });
    expect(a.calls.create[0]?.webhook_url).toBe('https://tamlil-bot-abc.vercel.app/api/soniox');
    const b = fakeClient({ createId: 'j' });
    await createSonioxGateway(prod, b.client).startFromUrl({ url: 'https://e.com/a.mp3', ref: 'r', webhookBase: 'https://tamlil-bot-abc.vercel.app' });
    expect(b.calls.create[0]?.webhook_url).toBe('https://tamlil-bot-abc.vercel.app/api/soniox');
    const c = fakeClient({ createId: 'j' });
    await createSonioxGateway(prod, c.client).startFromUrl({ url: 'https://e.com/a.mp3', ref: 'r' });
    expect(c.calls.create[0]?.webhook_url).toBe('https://tamlil-bot.vercel.app/api/soniox');
  });
  it('lets an explicit PUBLIC_BASE_URL win over the host Telegram called', async () => {
    const explicit = loadConfig({ ...base, PUBLIC_BASE_URL: 'https://bot.example.com/', VERCEL_PROJECT_PRODUCTION_URL: 'tamlil-bot.vercel.app' });
    const { client, calls } = fakeClient({ uploadId: 'f', createId: 'j' });
    await createSonioxGateway(explicit, client).startFromFile({ ...input(), webhookBase: 'https://tamlil-bot-abc.vercel.app' });
    expect(calls.create[0]?.webhook_url).toBe('https://bot.example.com/api/soniox');
  });
  it('sends no webhook without a secret, whatever the host', async () => {
    const { client, calls } = fakeClient({ uploadId: 'f', createId: 'j' });
    await createSonioxGateway({ ...config, sonioxWebhookSecret: '' }, client).startFromFile({ ...input(), webhookBase: 'https://a.vercel.app' });
    expect(calls.create[0]).not.toHaveProperty('webhook_url');
    expect(calls.create[0]).not.toHaveProperty('webhook_auth_header_value');
  });
  it('sends no webhook when publicBaseUrl is cleared and no host is given (setup smoke test)', async () => {
    const explicit = loadConfig({ ...base, PUBLIC_BASE_URL: 'https://bot.example.com' });
    const { client, calls } = fakeClient({ createId: 'j' });
    await createSonioxGateway({ ...explicit, publicBaseUrl: null }, client).startFromUrl({ url: 'https://e.com/a.mp3', ref: 'setup-smoke' });
    expect(calls.create[0]).not.toHaveProperty('webhook_url');
  });
  it('passes context only when configured', async () => {
    const { client, calls } = fakeClient({ uploadId: 'f', createId: 'j' });
    await createSonioxGateway({ ...config, sonioxContext: 'שגיא טויל' }, client).startFromUrl({ url: 'https://e.com/a.mp3', ref: 'r' });
    expect(calls.create[0]).toMatchObject({ audio_url: 'https://e.com/a.mp3', context: { text: 'שגיא טויל' } });
  });
  it('deletes the uploaded file when job creation fails', async () => {
    const { client, calls } = fakeClient({ uploadId: 'file-1', createError: new Error('boom') });
    await expect(createSonioxGateway(config, client).startFromFile(input())).rejects.toBeInstanceOf(SonioxStartError);
    expect(calls.fileDelete).toEqual(['file-1']);
  });
  it('a failing cleanup does not mask the start error', async () => {
    const { client } = fakeClient({ uploadId: 'file-1', createError: new Error('boom') });
    (client.files as unknown as { delete: () => Promise<void> }).delete = async () => {
      throw new Error('nope');
    };
    await expect(createSonioxGateway(config, client).startFromFile(input())).rejects.toBeInstanceOf(SonioxStartError);
  });
  it('maps 402 to payment and everything else to other, with fixed messages', async () => {
    const url = 'https://e.com/secret-audio';
    const e402 = await createSonioxGateway(config, fakeClient({ createError: httpError(402) }).client)
      .startFromUrl({ url, ref: 'r' })
      .catch((e: unknown) => e);
    const e500 = await createSonioxGateway(config, fakeClient({ createError: httpError(500) }).client)
      .startFromUrl({ url, ref: 'r' })
      .catch((e: unknown) => e);
    expect(e402).toBeInstanceOf(SonioxStartError);
    expect((e402 as SonioxStartError).kind).toBe('payment');
    expect((e500 as SonioxStartError).kind).toBe('other');
    for (const e of [e402, e500] as SonioxStartError[]) expect(e.message).not.toMatch(/secret|e\.com|500|402/);
  });
  it('an upload failure is also a SonioxStartError and nothing is deleted', async () => {
    const { client, calls } = fakeClient({ uploadError: new Error('x') });
    await expect(createSonioxGateway(config, client).startFromFile(input())).rejects.toMatchObject({ kind: 'other' });
    expect(calls.fileDelete).toEqual([]);
  });
});

describe('gateway read side', () => {
  it('maps a job', async () => {
    const { client } = fakeClient({ job: { id: 'j', status: 'completed', audio_duration_ms: 1200, client_reference_id: 'r', audio_url: 'https://e.com/a', file_id: null } });
    expect(await createSonioxGateway(config, client).getJob('j')).toEqual({ id: 'j', status: 'completed', durationMs: 1200, ref: 'r', isLink: true });
  });
  it('maps an uploaded-file job', async () => {
    const { client } = fakeClient({ job: { id: 'j', status: 'queued', audio_duration_ms: null, client_reference_id: null, audio_url: null, file_id: 'f' } });
    expect(await createSonioxGateway(config, client).getJob('j')).toEqual({ id: 'j', status: 'queued', durationMs: null, ref: null, isLink: false });
  });
  it('returns null for a missing job', async () => {
    expect(await createSonioxGateway(config, fakeClient({ job: null }).client).getJob('j')).toBeNull();
  });
  it('maps tokens', async () => {
    const { client } = fakeClient({
      tokens: [
        { text: 'a', start_ms: 1, end_ms: 2, confidence: 0.9, speaker: '1', language: 'he', is_audio_event: false },
        { text: 'b', confidence: 0.5 },
      ],
    });
    expect(await createSonioxGateway(config, client).getTokens('j')).toEqual([
      { text: 'a', start_ms: 1, end_ms: 2, confidence: 0.9, speaker: '1', language: 'he', is_audio_event: false },
      { text: 'b', start_ms: 0, end_ms: 0, confidence: 0.5, speaker: null, language: null, is_audio_event: null },
    ]);
  });
  it('rejects with a fixed message when the transcript is gone', async () => {
    await expect(createSonioxGateway(config, fakeClient().client).getTokens('job-123')).rejects.toThrow(
      'Soniox transcript is not available',
    );
  });
  it('destroy swallows a 409 and a 404 but rethrows others', async () => {
    await expect(createSonioxGateway(config, fakeClient({ destroyStatus: 409 }).client).destroy('j')).resolves.toBeUndefined();
    await expect(createSonioxGateway(config, fakeClient({ destroyStatus: 404 }).client).destroy('j')).resolves.toBeUndefined();
    await expect(createSonioxGateway(config, fakeClient({ destroyStatus: 500 }).client).destroy('j')).rejects.toBeTruthy();
  });
  it('counts leftovers across pages', async () => {
    const { client } = fakeClient({ fileCount: 5, jobCount: 3 });
    expect(await createSonioxGateway(config, client).countLeftovers()).toEqual({ transcriptions: 3, files: 5 });
  });
});

describe('verifySonioxWebhook', () => {
  const hook = (headers: Record<string, string>, body: string) =>
    new Request('https://x.vercel.app/api/soniox', { method: 'POST', headers, body });
  it('accepts a correct webhook', async () => {
    expect(await verifySonioxWebhook(hook({ 'x-tamlil-bot-secret': 'sec' }, '{"id":"j","status":"completed"}'), 'sec')).toEqual({ ok: true, id: 'j', status: 'completed' });
  });
  it('accepts an error status', async () => {
    expect(await verifySonioxWebhook(hook({ 'x-tamlil-bot-secret': 'sec' }, '{"id":"j","status":"error"}'), 'sec')).toEqual({ ok: true, id: 'j', status: 'error' });
  });
  it.each([
    [{}, '{"id":"j","status":"completed"}'],
    [{ 'x-tamlil-bot-secret': 'wrong' }, '{"id":"j","status":"completed"}'],
    [{ 'x-tamlil-bot-secret': 'sec' }, 'not json'],
    [{ 'x-tamlil-bot-secret': 'sec' }, 'null'],
    [{ 'x-tamlil-bot-secret': 'sec' }, '{"id":"","status":"completed"}'],
    [{ 'x-tamlil-bot-secret': 'sec' }, '{"id":5,"status":"completed"}'],
    [{ 'x-tamlil-bot-secret': 'sec' }, '{"id":"j","status":"processing"}'],
  ])('rejects a bad webhook %#', async (headers, body) => {
    expect(await verifySonioxWebhook(hook(headers as Record<string, string>, body), 'sec')).toEqual({ ok: false });
  });
  it('rejects when the secret is empty', async () => {
    expect(await verifySonioxWebhook(hook({ 'x-tamlil-bot-secret': '' }, '{"id":"j","status":"completed"}'), '')).toEqual({ ok: false });
  });
});

describe('hardening', () => {
  it('omits webhook fields when the secret is empty', async () => {
    const { client, calls } = fakeClient({ uploadId: 'f', createId: 'j' });
    await createSonioxGateway({ ...config, sonioxWebhookSecret: '' }, client).startFromFile(input());
    expect(calls.create[0]).not.toHaveProperty('webhook_url');
    expect(calls.create[0]).not.toHaveProperty('webhook_auth_header_name');
    expect(calls.create[0]).not.toHaveProperty('webhook_auth_header_value');
  });
  it('exposes the HTTP status on the start error', async () => {
    const e = await createSonioxGateway(config, fakeClient({ createError: httpError(500) }).client)
      .startFromUrl({ url: 'https://e.com/a', ref: 'r' })
      .catch((x: unknown) => x);
    expect((e as SonioxStartError).status).toBe(500);
    const plain = await createSonioxGateway(config, fakeClient({ createError: new Error('x') }).client)
      .startFromUrl({ url: 'https://e.com/a', ref: 'r' })
      .catch((x: unknown) => x);
    expect((plain as SonioxStartError).status).toBeNull();
  });
  it('reads a numeric statusCode from a non-SDK error', async () => {
    const e = await createSonioxGateway(config, fakeClient({ createError: Object.assign(new Error('x'), { statusCode: 402 }) }).client)
      .startFromUrl({ url: 'https://e.com/a', ref: 'r' })
      .catch((x: unknown) => x);
    expect((e as SonioxStartError).kind).toBe('payment');
    expect((e as SonioxStartError).status).toBe(402);
    expect((e as SonioxStartError).message).toBe('Soniox rejected the request: payment required');
  });
});
