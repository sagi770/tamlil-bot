import { MAX_REDIRECTS, preflightMediaUrl } from '../src/media-fetch.js';

const res = (status: number, headers: Record<string, string> = {}, cancel = vi.fn()) =>
  ({ status, ok: status >= 200 && status < 300, headers: new Headers(headers), body: { cancel } }) as unknown as Response;
const chain = (...responses: Response[]) => {
  const f = vi.fn();
  responses.forEach((r) => f.mockResolvedValueOnce(r));
  return f as unknown as typeof fetch;
};

describe('preflightMediaUrl', () => {
  it('follows a safe redirect and returns the final URL without reading the body', async () => {
    const cancel = vi.fn();
    const fetchImpl = chain(
      res(302, { location: 'https://cdn.example.com/a.mp3' }),
      res(200, { 'content-type': 'audio/mpeg', 'content-length': '5000' }, cancel),
    );
    expect(await preflightMediaUrl('https://example.com/a', { fetchImpl })).toEqual({
      ok: true,
      finalUrl: 'https://cdn.example.com/a.mp3',
      contentType: 'audio/mpeg',
      contentLength: 5000,
    });
    expect(cancel).toHaveBeenCalled();
  });
  it('sends GET with manual redirect and the bot user-agent', async () => {
    const fetchImpl = chain(res(200));
    await preflightMediaUrl('https://example.com/a', { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith('https://example.com/a', {
      method: 'GET',
      redirect: 'manual',
      headers: { 'user-agent': 'tamlil-bot/1.0' },
      signal: expect.any(AbortSignal),
    });
  });
  it('cancels the body of a followed redirect too', async () => {
    const cancel = vi.fn();
    const fetchImpl = chain(res(302, { location: 'https://cdn.example.com/a.mp3' }, cancel), res(200));
    await preflightMediaUrl('https://example.com/a', { fetchImpl });
    expect(cancel).toHaveBeenCalled();
  });
  it('resolves a relative redirect against the current URL', async () => {
    const fetchImpl = chain(res(301, { location: '/b.mp3' }), res(200, { 'content-type': 'audio/mpeg' }));
    expect(await preflightMediaUrl('https://example.com/a', { fetchImpl })).toMatchObject({
      ok: true,
      finalUrl: 'https://example.com/b.mp3',
      contentLength: null,
    });
  });
  it('refuses a redirect to an unsafe host', async () => {
    const cancel = vi.fn();
    expect(
      await preflightMediaUrl('https://example.com/a', { fetchImpl: chain(res(302, { location: 'http://10.0.0.1/a' }, cancel)) }),
    ).toEqual({ ok: false, reason: 'unsafe-redirect' });
    expect(cancel).toHaveBeenCalled();
  });
  it('gives up after MAX_REDIRECTS', async () => {
    expect(MAX_REDIRECTS).toBe(5);
    const hops = Array.from({ length: 6 }, (_, i) => res(302, { location: `https://example.com/${i}` }));
    expect(await preflightMediaUrl('https://example.com/a', { fetchImpl: chain(...hops) })).toEqual({
      ok: false,
      reason: 'too-many-redirects',
    });
  });
  it('rejects an HTML page and cancels its body', async () => {
    const cancel = vi.fn();
    expect(
      await preflightMediaUrl('https://example.com/a', {
        fetchImpl: chain(res(200, { 'content-type': 'text/html; charset=utf-8' }, cancel)),
      }),
    ).toEqual({ ok: false, reason: 'not-media' });
    expect(cancel).toHaveBeenCalled();
  });
  it('accepts a response with no content type', async () => {
    expect((await preflightMediaUrl('https://example.com/a', { fetchImpl: chain(res(200)) })).ok).toBe(true);
  });
  it('is not affected by a body.cancel that throws', async () => {
    const cancel = vi.fn(() => {
      throw new Error('nope');
    });
    expect(
      await preflightMediaUrl('https://example.com/a', { fetchImpl: chain(res(200, { 'content-type': 'audio/mpeg' }, cancel)) }),
    ).toMatchObject({ ok: true, contentType: 'audio/mpeg' });
  });
  it('is not affected by a body.cancel that rejects', async () => {
    const cancel = vi.fn(() => Promise.reject(new Error('nope')));
    expect(await preflightMediaUrl('https://example.com/a', { fetchImpl: chain(res(404, {}, cancel)) })).toEqual({
      ok: false,
      reason: 'fetch-failed',
    });
  });
  it('reports an HTTP error and a network error as fetch-failed', async () => {
    expect(await preflightMediaUrl('https://example.com/a', { fetchImpl: chain(res(404)) })).toEqual({ ok: false, reason: 'fetch-failed' });
    const boom = vi.fn().mockRejectedValue(new Error('x')) as unknown as typeof fetch;
    expect(await preflightMediaUrl('https://example.com/a', { fetchImpl: boom })).toEqual({ ok: false, reason: 'fetch-failed' });
  });
  it('reports a redirect with no location as fetch-failed', async () => {
    expect(await preflightMediaUrl('https://example.com/a', { fetchImpl: chain(res(302)) })).toEqual({ ok: false, reason: 'fetch-failed' });
  });
});

describe('preflightMediaUrl hardening', () => {
  it('follows a multi-hop chain with a relative redirect on a different host', async () => {
    const fetchImpl = chain(
      res(302, { location: 'https://cdn.other.com/x' }),
      res(302, { location: '/y' }),
      res(200, { 'content-type': 'audio/mpeg' }),
    );
    expect(await preflightMediaUrl('https://example.com/a', { fetchImpl })).toMatchObject({
      ok: true,
      finalUrl: 'https://cdn.other.com/y',
    });
  });
  it('refuses an https redirect to localhost', async () => {
    expect(
      await preflightMediaUrl('https://example.com/a', { fetchImpl: chain(res(302, { location: 'https://localhost/' })) }),
    ).toEqual({ ok: false, reason: 'unsafe-redirect' });
  });
  it('accepts exactly MAX_REDIRECTS redirects followed by a 200', async () => {
    const hops = Array.from({ length: MAX_REDIRECTS }, (_, i) => res(302, { location: `https://example.com/${i}` }));
    expect(
      (await preflightMediaUrl('https://example.com/a', { fetchImpl: chain(...hops, res(200, { 'content-type': 'audio/mpeg' })) })).ok,
    ).toBe(true);
  });
  it('guards hop 0 itself', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    expect(await preflightMediaUrl('http://10.0.0.1/a', { fetchImpl })).toEqual({ ok: false, reason: 'unsafe-redirect' });
    expect(await preflightMediaUrl('https://localhost/a', { fetchImpl })).toEqual({ ok: false, reason: 'unsafe-redirect' });
    expect(await preflightMediaUrl('not a url', { fetchImpl })).toEqual({ ok: false, reason: 'fetch-failed' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('times out across all hops as fetch-failed', async () => {
    const fetchImpl = vi.fn(
      (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    ) as unknown as typeof fetch;
    expect(await preflightMediaUrl('https://example.com/a', { fetchImpl, timeoutMs: 20 })).toEqual({
      ok: false,
      reason: 'fetch-failed',
    });
  });
});
