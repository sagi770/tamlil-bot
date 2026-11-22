import { createTelegramAdmin } from '../../scripts/lib/telegram-admin.js';

const ok = (result: unknown) => new Response(JSON.stringify({ ok: true, result }));

describe('createTelegramAdmin.getUpdates', () => {
  it('passes the abort signal to fetch', async () => {
    const fetchImpl = vi.fn(async () => ok([]));
    const ctl = new AbortController();
    await createTelegramAdmin('t', fetchImpl as never).getUpdates({ offset: 3, timeoutSec: 25, signal: ctl.signal });
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.signal).toBe(ctl.signal);
    expect(JSON.parse(init.body as string)).toEqual({ offset: 3, timeout: 25 });
  });

  it('sends no signal when none is given', async () => {
    const fetchImpl = vi.fn(async () => ok([]));
    await createTelegramAdmin('t', fetchImpl as never).getUpdates();
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect('signal' in init).toBe(false);
  });

  it('fails with a generic message when the request is aborted', async () => {
    const ctl = new AbortController();
    ctl.abort();
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
      return ok([]);
    });
    const admin = createTelegramAdmin('secret-token', fetchImpl as never);
    const err = await admin.getUpdates({ signal: ctl.signal }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('Telegram getUpdates request failed');
    expect((err as Error).message).not.toContain('secret-token');
  });
});

const bodyOf = (fetchImpl: { mock: { calls: unknown[][] } }) =>
  JSON.parse((fetchImpl.mock.calls[0][1] as RequestInit).body as string) as unknown;

describe('createTelegramAdmin payloads', () => {
  it('setWebhook sends url, secret_token and allowed_updates', async () => {
    const fetchImpl = vi.fn(async () => ok(true));
    await createTelegramAdmin('t', fetchImpl as never).setWebhook({ url: 'https://x.test/api/telegram', secret: 's3cret' });
    expect(bodyOf(fetchImpl)).toEqual({
      url: 'https://x.test/api/telegram',
      secret_token: 's3cret',
      allowed_updates: ['message', 'callback_query'],
    });
  });

  it('deleteWebhook keeps pending updates', async () => {
    const fetchImpl = vi.fn(async () => ok(true));
    await createTelegramAdmin('t', fetchImpl as never).deleteWebhook();
    expect(bodyOf(fetchImpl)).toEqual({ drop_pending_updates: false });
  });

  it('getMe and getWebhookInfo pass an abort signal to fetch', async () => {
    const ctl = new AbortController();
    const fetchImpl = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => ok({ id: 1, username: 'b', url: '' }));
    const admin = createTelegramAdmin('t', fetchImpl as never);
    await admin.getMe(ctl.signal);
    await admin.getWebhookInfo(ctl.signal);
    expect(fetchImpl.mock.calls).toHaveLength(2);
    for (const call of fetchImpl.mock.calls) expect(call[1].signal).toBe(ctl.signal);
  });
});
