import { deliverSummary, deliverTranscript, sendOpenWarningIfNeeded } from '../src/deliver.js';
import { makeDeps } from './helpers/fakes.js';

const seg = (speakerKey: string, startMs: number, text: string) => ({ speakerKey, startMs, endMs: startMs + 1000, text, language: 'he' });
const summarizer = { summarize: vi.fn().mockResolvedValue({ text: 'תקציר', truncated: false }) };

describe('deliverTranscript', () => {
  it('sends a short transcript as one message with the footer, replying to the recording', async () => {
    const { deps, tg } = makeDeps();
    const out = await deliverTranscript(deps, { chatId: 5, replyTo: 3, segments: [seg('1', 0, 'שלום')], durationMs: 12_000 });
    expect(tg.calls).toEqual([{ method: 'sendMessage', args: [5, 'שלום\n\n⏱ 0:12', { replyTo: 3, keyboard: undefined }] }]);
    expect(out.transcriptText).toBe('שלום');
    expect(out.messageId).toBe(100);
  });
  it('adds the summary button only when a summarizer exists', async () => {
    const { deps, tg } = makeDeps({ summarizer });
    await deliverTranscript(deps, { chatId: 5, replyTo: 3, segments: [seg('1', 0, 'שלום')], durationMs: 1000 });
    expect(tg.calls[0].args[2].keyboard).toEqual([[{ text: '📋 סכם', callback_data: 'sum' }]]);
  });
  it('sends a long transcript as a .txt file with the footer as caption', async () => {
    const { deps, tg } = makeDeps({ now: () => new Date(Date.UTC(2026, 10, 20, 12, 30)) });
    const out = await deliverTranscript(deps, { chatId: 5, replyTo: 3, segments: [seg('1', 0, 'א'.repeat(4000))], durationMs: 60_000 });
    expect(tg.calls[0].method).toBe('sendDocument');
    expect(tg.calls[0].args[1].name).toBe('תמליל 2026-11-20 14-30.txt');
    expect(tg.calls[0].args[2].caption).toBe('⏱ 1:00');
    expect(out.transcriptText).toBe(tg.calls[0].args[1].content);
  });
  it('throws without sending when there are no segments', async () => {
    const { deps, tg } = makeDeps();
    await expect(deliverTranscript(deps, { chatId: 5, replyTo: 3, segments: [], durationMs: 1000 })).rejects.toThrow();
    expect(tg.calls).toEqual([]);
  });
});

describe('deliverSummary', () => {
  it('sends the summary under its header', async () => {
    const { deps, tg } = makeDeps({ summarizer });
    expect(await deliverSummary(deps, { chatId: 5, replyTo: 9, transcript: 'x' })).toBe(true);
    expect(tg.calls[0].args.slice(0, 2)).toEqual([5, '📋 סיכום\n\nתקציר']);
    expect(tg.calls[0].args[2]).toEqual({ replyTo: 9 });
  });
  it('appends the truncation notice', async () => {
    const { deps, tg } = makeDeps({ summarizer: { summarize: vi.fn().mockResolvedValue({ text: 'ת', truncated: true }) } });
    await deliverSummary(deps, { chatId: 5, replyTo: 9, transcript: 'x' });
    expect(tg.calls[0].args[1]).toBe(`📋 סיכום\n\nת\n\n${deps.s.summaryTruncated}`);
  });
  it('reports a summarizer failure to the user, logs only the error class, and returns false', async () => {
    const { deps, tg } = makeDeps({ summarizer: { summarize: vi.fn().mockRejectedValue(new TypeError('secret-text')) } });
    expect(await deliverSummary(deps, { chatId: 5, replyTo: 9, transcript: 'x' })).toBe(false);
    expect(tg.calls[0].args[1]).toBe(deps.s.summaryFailed);
    expect(tg.calls[0].args[2]).toEqual({ replyTo: 9 });
    expect(deps.log.error).toHaveBeenCalledWith('summary_failed', { error: 'TypeError' });
  });
  it('returns false without sending when there is no summarizer', async () => {
    const { deps, tg } = makeDeps();
    expect(await deliverSummary(deps, { chatId: 5, replyTo: 9, transcript: 'x' })).toBe(false);
    expect(tg.calls).toEqual([]);
  });
  it('propagates a failure to send the summary', async () => {
    const { deps, tg } = makeDeps({ summarizer });
    tg.handlers.sendMessage = () => Promise.reject(new Error('send failed'));
    await expect(deliverSummary(deps, { chatId: 5, replyTo: 9, transcript: 'x' })).rejects.toThrow('send failed');
    expect(tg.calls).toHaveLength(1);
  });
});

describe('sendOpenWarningIfNeeded', () => {
  it('warns only in open-warn mode', async () => {
    const open = makeDeps();
    await sendOpenWarningIfNeeded(open.deps, 5, 5);
    expect(open.tg.calls[0].args[1]).toBe(open.deps.s.openWarning(5));
    const locked = makeDeps({ env: { ALLOWED_USER_IDS: '5' } });
    await sendOpenWarningIfNeeded(locked.deps, 5, 5);
    expect(locked.tg.calls).toEqual([]);
    const pub = makeDeps({ env: { ALLOW_ALL_USERS: 'true' } });
    await sendOpenWarningIfNeeded(pub.deps, 5, 5);
    expect(pub.tg.calls).toEqual([]);
  });
});
