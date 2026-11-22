import { ConfigError } from '../../src/config.js';
import { createSonioxHandler, createTelegramHandler } from '../../src/http.js';
import { classifyProbe, readProbe } from '../../scripts/lib/probe.js';
import { makeDeps } from '../helpers/fakes.js';

const post = () => new Request('https://bot.example/api/telegram', { method: 'POST', body: '{}' });
const html = (status: number) =>
  new Response('<!doctype html><html><title>Authentication Required</title></html>', {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

describe('classifyProbe', () => {
  it('recognises our own 401 from the real handler', async () => {
    const { deps } = makeDeps();
    const res = await createTelegramHandler(() => deps, vi.fn())(post());
    expect(classifyProbe(await readProbe(res))).toBe('ours');
  });

  it("recognises our own 401 from the real Soniox handler", async () => {
    const { deps } = makeDeps();
    const res = await createSonioxHandler(() => deps, vi.fn())(new Request('https://bot.example/api/soniox', { method: 'POST', body: '{}' }));
    expect(classifyProbe(await readProbe(res))).toBe('ours');
  });

  it("recognises the handler's missing-configuration 500", async () => {
    const log = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const res = await createTelegramHandler(() => {
        throw new ConfigError(['TELEGRAM_WEBHOOK_SECRET']);
      }, vi.fn())(post());
      expect(classifyProbe(await readProbe(res))).toBe('config-error');
    } finally {
      log.mockRestore();
    }
  });

  it('recognises a Deployment Protection page or redirect', async () => {
    expect(classifyProbe(await readProbe(html(401)))).toBe('protected');
    expect(classifyProbe(await readProbe(html(403)))).toBe('protected');
    const redirect = new Response(null, { status: 307, headers: { location: 'https://vercel.com/sso-api?url=x' } });
    expect(classifyProbe(await readProbe(redirect))).toBe('protected');
  });

  it('reports a missing function and anything else', async () => {
    expect(classifyProbe(await readProbe(new Response('The page could not be found', { status: 404 })))).toBe(
      'not-found',
    );
    expect(classifyProbe(await readProbe(new Response('ok', { status: 200 })))).toBe('unexpected');
    expect(classifyProbe(await readProbe(new Response('nope', { status: 401 })))).toBe('unexpected');
  });
});
