import { handleSonioxEvent } from '../src/handle-soniox.js';
import { encodeRef } from '../src/reference.js';
import type { SonioxJob } from '../src/soniox.js';
import type { Summarizer } from '../src/summarize.js';
import type { SonioxToken } from '../src/types.js';
import { makeDeps } from './helpers/fakes.js';
import type { RecordedCall } from './helpers/fakes.js';

const CHAT = 50;
const REPLY_TO = 10;
const STATUS_ID = 11;
const REF = (mode: 't' | 's' = 't') => encodeRef({ chatId: CHAT, replyTo: REPLY_TO, statusMessageId: STATUS_ID, mode });
const tok = (text: string, start: number, extra: Partial<SonioxToken> = {}): SonioxToken => ({
  text,
  start_ms: start,
  end_ms: start + 400,
  confidence: 0.9,
  speaker: '1',
  language: 'he',
  ...extra,
});
const job = (extra: Partial<SonioxJob> = {}): SonioxJob => ({
  id: 'job-1',
  status: 'completed',
  durationMs: 5000,
  ref: REF(),
  isLink: false,
  ...extra,
});
const event = (status: 'completed' | 'error' = 'completed') => ({ id: 'job-1', status });
const summarizer = (): Summarizer => ({ summarize: vi.fn().mockResolvedValue({ text: 'תקציר', truncated: false }) });
const methods = (calls: RecordedCall[]) => calls.map((c) => c.method);
const sends = (calls: RecordedCall[]) => calls.filter((c) => c.method === 'sendMessage');

function setup(opts: { job?: SonioxJob | null; tokens?: SonioxToken[]; summarizer?: Summarizer | null; env?: Record<string, string> } = {}) {
  const made = makeDeps({ summarizer: opts.summarizer ?? null, env: opts.env });
  made.soniox.handlers.getJob = async () => (opts.job === undefined ? job() : opts.job);
  made.soniox.handlers.getTokens = async () => opts.tokens ?? [tok('שלום', 0), tok(' עולם', 400)];
  return made;
}

describe('handleSonioxEvent', () => {
  it('does nothing when the job no longer exists', async () => {
    const { deps, tg, soniox } = setup({ job: null });
    expect(await handleSonioxEvent(deps, event())).toEqual({ status: 200, background: null });
    expect(tg.calls).toEqual([]);
    expect(methods(soniox.calls)).toEqual(['getJob']);
  });

  it('destroys a job with an undecodable ref without calling Telegram', async () => {
    const { deps, tg, soniox } = setup({ job: job({ ref: 'garbage' }) });
    const r = await handleSonioxEvent(deps, event());
    expect(r).toEqual({ status: 200, background: null });
    expect(tg.calls).toEqual([]);
    expect(soniox.calls.filter((c) => c.method === 'destroy')).toHaveLength(1);
  });

  it('answers 500 without sending when the job lookup fails', async () => {
    const { deps, tg, soniox } = setup();
    soniox.handlers.getJob = () => Promise.reject(new Error('network'));
    expect(await handleSonioxEvent(deps, event())).toEqual({ status: 500, background: null });
    expect(tg.calls).toEqual([]);
    expect(methods(soniox.calls)).toEqual(['getJob']);
    expect(deps.log.error).toHaveBeenCalledWith('job_lookup_failed', { error: 'Error' });
  });

  it.each(['queued', 'processing'] as const)('answers 500 and logs a %s job, so a retry may find it finished', async (status) => {
    const { deps, tg, soniox } = setup({ job: job({ status }) });
    expect(await handleSonioxEvent(deps, event())).toEqual({ status: 500, background: null });
    expect(deps.log.info).toHaveBeenCalledWith('job_not_finished', { status });
    expect(tg.calls).toEqual([]);
    expect(methods(soniox.calls)).toEqual(['getJob']);
  });

  it('delivers the transcript as a reply, then deletes the status message, then destroys', async () => {
    const { deps, tg, soniox } = setup();
    const order: string[] = [];
    tg.handlers.sendMessage = async () => (order.push('send'), { message_id: 77 });
    tg.handlers.deleteMessage = async () => void order.push('delete');
    soniox.handlers.destroy = async () => void order.push('destroy');
    const r = await handleSonioxEvent(deps, event());
    expect(r.status).toBe(200);
    await r.background;
    expect(order.slice(0, 3)).toEqual(['send', 'delete', 'destroy']);
    const send = sends(tg.calls)[0];
    expect(send?.args[0]).toBe(CHAT);
    expect(send?.args[1]).toContain('שלום');
    expect(send?.args[2]).toMatchObject({ replyTo: REPLY_TO });
    expect(tg.calls.find((c) => c.method === 'deleteMessage')?.args).toEqual([CHAT, STATUS_ID]);
  });

  it('sends noSpeech when every token is dropped, never an empty message', async () => {
    const { deps, tg, soniox } = setup({ tokens: [tok('', 0), tok('[music]', 100, { is_audio_event: true })] });
    await (await handleSonioxEvent(deps, event())).background;
    const s = sends(tg.calls);
    expect(s[0]?.args[1]).toBe(deps.s.noSpeech);
    expect(s[0]?.args[2]).toMatchObject({ replyTo: REPLY_TO });
    expect(s.every((c) => String(c.args[1]).trim() !== '')).toBe(true);
    expect(methods(tg.calls)).toContain('deleteMessage');
    expect(methods(soniox.calls)).toContain('destroy');
  });

  it('reports an error job as sonioxFailed and destroys it', async () => {
    const { deps, tg, soniox } = setup({ job: job({ status: 'error' }) });
    const r = await handleSonioxEvent(deps, event('error'));
    expect(r.status).toBe(200);
    await r.background;
    expect(sends(tg.calls)[0]?.args[1]).toBe(deps.s.sonioxFailed);
    expect(sends(tg.calls)[0]?.args[2]).toMatchObject({ replyTo: REPLY_TO });
    expect(methods(tg.calls)).toContain('deleteMessage');
    expect(methods(soniox.calls)).toContain('destroy');
    expect(methods(soniox.calls)).not.toContain('getTokens');
  });

  it('reports a failed link job as linkJobFailed', async () => {
    const { deps, tg, soniox } = setup({ job: job({ status: 'error', isLink: true }) });
    await (await handleSonioxEvent(deps, event('error'))).background;
    expect(sends(tg.calls)[0]?.args[1]).toBe(deps.s.linkJobFailed);
    expect(methods(soniox.calls)).toContain('destroy');
  });

  it('on an error job sends the error text first, then deletes the status, then destroys', async () => {
    const { deps, tg, soniox } = setup({ job: job({ status: 'error' }) });
    const order: string[] = [];
    tg.handlers.sendMessage = async () => (order.push('send'), { message_id: 77 });
    tg.handlers.deleteMessage = async () => void order.push('delete');
    soniox.handlers.destroy = async () => void order.push('destroy');
    const r = await handleSonioxEvent(deps, event('error'));
    expect(r.status).toBe(200);
    await r.background;
    expect(order).toEqual(['send', 'delete', 'destroy']);
  });

  it('answers once the result is out; the status delete and destroy wait in the background', async () => {
    const { deps, tg, soniox } = setup();
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    tg.handlers.deleteMessage = () => gate;
    const r = await handleSonioxEvent(deps, event());
    expect(r.status).toBe(200);
    expect(methods(soniox.calls)).not.toContain('destroy');
    expect(sends(tg.calls)).toHaveLength(1); // the open warning has not gone out yet
    release();
    await r.background;
    expect(methods(soniox.calls)).toContain('destroy');
    expect(sends(tg.calls)).toHaveLength(2);
  });

  it('uses the job status, not the event status', async () => {
    const { deps, tg } = setup({ job: job({ status: 'error' }) });
    await handleSonioxEvent(deps, event('completed'));
    expect(sends(tg.calls)[0]?.args[1]).toBe(deps.s.sonioxFailed);
  });

  it('returns 500 and keeps the job when the transcript send rejects', async () => {
    const { deps, tg, soniox } = setup();
    tg.handlers.sendMessage = () => Promise.reject(new Error('boom'));
    expect(await handleSonioxEvent(deps, event())).toEqual({ status: 500, background: null });
    expect(methods(soniox.calls)).not.toContain('destroy');
    expect(methods(tg.calls)).not.toContain('deleteMessage');
  });

  it('returns 500 and keeps the job when the error text cannot be sent', async () => {
    const { deps, tg, soniox } = setup({ job: job({ status: 'error' }) });
    tg.handlers.sendMessage = () => Promise.reject(new Error('boom'));
    expect(await handleSonioxEvent(deps, event('error'))).toEqual({ status: 500, background: null });
    expect(methods(soniox.calls)).not.toContain('destroy');
    expect(methods(tg.calls)).not.toContain('deleteMessage');
  });

  it('returns 500 without sending or destroying when getTokens rejects', async () => {
    const { deps, tg, soniox } = setup();
    soniox.handlers.getTokens = () => Promise.reject(new Error('gone'));
    expect(await handleSonioxEvent(deps, event())).toEqual({ status: 500, background: null });
    expect(tg.calls).toEqual([]);
    expect(methods(soniox.calls)).not.toContain('destroy');
  });

  it('still answers 200 and logs when destroy rejects after a successful send', async () => {
    const { deps, soniox } = setup();
    soniox.handlers.destroy = () => Promise.reject(new Error('boom'));
    const r = await handleSonioxEvent(deps, event());
    expect(r.status).toBe(200);
    await expect(r.background).resolves.toBeUndefined();
    expect(deps.log.error).toHaveBeenCalledWith('destroy_failed', { error: 'Error' });
  });

  it('still answers 200 when the status message cannot be deleted, and still destroys', async () => {
    const { deps, tg, soniox } = setup();
    tg.handlers.deleteMessage = () => Promise.reject(new Error('boom'));
    const r = await handleSonioxEvent(deps, event());
    expect(r.status).toBe(200);
    await expect(r.background).resolves.toBeUndefined();
    expect(deps.log.error).toHaveBeenCalledWith('status_delete_failed', { error: 'Error' });
    expect(methods(soniox.calls)).toContain('destroy');
  });

  it('sends the open warning after the transcript in open-warn mode', async () => {
    const { deps, tg } = setup();
    await (await handleSonioxEvent(deps, event())).background;
    const s = sends(tg.calls);
    expect(s).toHaveLength(2);
    expect(s[1]?.args[1]).toBe(deps.s.openWarning(CHAT));
  });

  it('does not send the open warning when access is locked', async () => {
    const { deps, tg } = setup({ env: { ALLOWED_USER_IDS: '1' } });
    await (await handleSonioxEvent(deps, event())).background;
    expect(sends(tg.calls)).toHaveLength(1);
  });

  it('swallows a failing open warning', async () => {
    const { deps, tg } = setup();
    let n = 0;
    tg.handlers.sendMessage = async () => {
      if (++n === 2) throw new Error('boom');
      return { message_id: 5 };
    };
    const r = await handleSonioxEvent(deps, event());
    expect(r.status).toBe(200);
    await expect(r.background).resolves.toBeUndefined();
    expect(deps.log.error).toHaveBeenCalledWith('open_warning_failed', { error: 'Error' });
  });

  it('runs every background step in order even when each one fails, and never rejects', async () => {
    const { deps, tg, soniox } = setup({ job: job({ ref: REF('s') }), summarizer: summarizer() });
    let n = 0;
    tg.handlers.sendMessage = async () => {
      if (++n > 1) throw new Error('down');
      return { message_id: 77 };
    };
    tg.handlers.deleteMessage = () => Promise.reject(new Error('down'));
    soniox.handlers.destroy = () => Promise.reject(new Error('down'));
    const r = await handleSonioxEvent(deps, event());
    expect(r.status).toBe(200);
    await expect(r.background).resolves.toBeUndefined();
    expect(vi.mocked(deps.log.error).mock.calls.map((c) => c[0])).toEqual([
      'status_delete_failed',
      'destroy_failed',
      'open_warning_failed',
      'summary_background_failed',
    ]);
  });

  it('returns a summary background task for mode s with a summarizer', async () => {
    const { deps, tg } = setup({ job: job({ ref: REF('s') }), summarizer: summarizer(), env: { ALLOW_ALL_USERS: 'true' } });
    tg.handlers.sendMessage = async () => ({ message_id: 77 });
    const r = await handleSonioxEvent(deps, event());
    expect(r.status).toBe(200);
    expect(r.background).toBeInstanceOf(Promise);
    await r.background;
    const s = sends(tg.calls);
    expect(s).toHaveLength(2);
    expect(s[1]?.args[1]).toContain('תקציר');
    expect(s[1]?.args[2]).toMatchObject({ replyTo: 77 });
  });

  it('removes the summary button from the transcript once the summary is sent', async () => {
    const { deps, tg } = setup({ job: job({ ref: REF('s') }), summarizer: summarizer(), env: { ALLOW_ALL_USERS: 'true' } });
    tg.handlers.sendMessage = async () => ({ message_id: 77 });
    await (await handleSonioxEvent(deps, event())).background;
    const names = tg.calls.map((c) => c.method);
    expect(names.indexOf('removeKeyboard')).toBeGreaterThan(names.lastIndexOf('sendMessage'));
    expect(tg.calls.filter((c) => c.method === 'removeKeyboard')).toEqual([{ method: 'removeKeyboard', args: [CHAT, 77] }]);
  });

  it('keeps the summary button when the summary fails', async () => {
    const failing: Summarizer = { summarize: vi.fn().mockRejectedValue(new Error('openai down')) };
    const { deps, tg } = setup({ job: job({ ref: REF('s') }), summarizer: failing, env: { ALLOW_ALL_USERS: 'true' } });
    tg.handlers.sendMessage = async () => ({ message_id: 77 });
    await (await handleSonioxEvent(deps, event())).background;
    expect(tg.calls.some((c) => c.method === 'removeKeyboard')).toBe(false);
  });

  it('logs and swallows a failure to remove the button', async () => {
    const { deps, tg } = setup({ job: job({ ref: REF('s') }), summarizer: summarizer(), env: { ALLOW_ALL_USERS: 'true' } });
    tg.handlers.sendMessage = async () => ({ message_id: 77 });
    tg.handlers.removeKeyboard = () => Promise.reject(new Error('gone'));
    await expect((await handleSonioxEvent(deps, event())).background).resolves.toBeUndefined();
    expect(deps.log.error).toHaveBeenCalledWith('remove_keyboard_failed', { error: 'Error' });
  });

  it('never rejects from the summary background task', async () => {
    const failing: Summarizer = { summarize: vi.fn().mockRejectedValue(new Error('openai down')) };
    const { deps, tg } = setup({ job: job({ ref: REF('s') }), summarizer: failing, env: { ALLOW_ALL_USERS: 'true' } });
    let n = 0;
    tg.handlers.sendMessage = async () => {
      if (++n > 1) throw new Error('telegram down');
      return { message_id: 77 };
    };
    const r = await handleSonioxEvent(deps, event());
    await expect(r.background).resolves.toBeUndefined();
    expect(deps.log.error).toHaveBeenCalledWith('summary_background_failed', { error: 'Error' });
  });

  it('sends no summary for mode s without a summarizer', async () => {
    const { deps, tg } = setup({ job: job({ ref: REF('s') }), env: { ALLOW_ALL_USERS: 'true' } });
    await (await handleSonioxEvent(deps, event())).background;
    expect(sends(tg.calls)).toHaveLength(1);
  });

  it('sends no summary for mode t with a summarizer', async () => {
    const s = summarizer();
    const { deps, tg } = setup({ summarizer: s, env: { ALLOW_ALL_USERS: 'true' } });
    await (await handleSonioxEvent(deps, event())).background;
    expect(s.summarize).not.toHaveBeenCalled();
    expect(sends(tg.calls)).toHaveLength(1);
  });

  it('sends no summary when there was no speech', async () => {
    const s = summarizer();
    const { deps, tg } = setup({ job: job({ ref: REF('s') }), summarizer: s, tokens: [], env: { ALLOW_ALL_USERS: 'true' } });
    await (await handleSonioxEvent(deps, event())).background;
    expect(s.summarize).not.toHaveBeenCalled();
    expect(sends(tg.calls).map((c) => c.args[1])).toEqual([deps.s.noSpeech]);
  });
});
