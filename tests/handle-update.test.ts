import { handleUpdate } from '../src/handle-update.js';
import { encodeRef } from '../src/reference.js';
import { SonioxStartError } from '../src/soniox.js';
import { TelegramApiError } from '../src/telegram.js';
import type { TgMessage, TgUpdate } from '../src/telegram-types.js';
import type { Summarizer } from '../src/summarize.js';
import { makeDeps } from './helpers/fakes.js';
import type { RecordedCall } from './helpers/fakes.js';

const CHAT = 50;
const USER = 1;
const priv = { id: CHAT, type: 'private' as const };
const msg = (extra: Partial<TgMessage> = {}): TgMessage => ({
  message_id: 10,
  date: 1000,
  chat: priv,
  from: { id: USER },
  ...extra,
});
const upd = (message: TgMessage): TgUpdate => ({ update_id: 1, message });
const summarizer = (): Summarizer => ({ summarize: vi.fn().mockResolvedValue({ text: 'תקציר', truncated: false }) });
const sent = (tg: { calls: RecordedCall[] }) => tg.calls.filter((c) => c.method === 'sendMessage');
const lastText = (tg: { calls: RecordedCall[] }) => sent(tg).at(-1)?.args[1];
const methods = (tg: { calls: RecordedCall[] }) => tg.calls.map((c) => c.method);
/** First sendMessage (the status message) succeeds, every later one rejects. */
const onlyFirstSendSucceeds = () => {
  let n = 0;
  return async () => {
    if (++n === 1) return { message_id: 100 };
    throw new Error('boom');
  };
};
const okPreflight = (finalUrl = 'https://cdn/x') =>
  vi.fn().mockResolvedValue({ ok: true, finalUrl, contentType: 'audio/mpeg', contentLength: 1 });
const callback = (message: TgMessage | undefined, data = 'sum', fromId = USER): TgUpdate => ({
  update_id: 2,
  callback_query: { id: 'cb1', from: { id: fromId }, data, message },
});

describe('handleUpdate routing', () => {
  it('1 ignores updates without message or callback_query', async () => {
    const { deps, tg, soniox } = makeDeps();
    await handleUpdate(deps, { update_id: 1, edited_message: msg() } as unknown as TgUpdate);
    expect(tg.calls).toEqual([]);
    expect(soniox.calls).toEqual([]);
  });
  it('2 ignores group chats', async () => {
    const { deps, tg, soniox } = makeDeps();
    await handleUpdate(deps, upd(msg({ chat: { id: -5, type: 'group' }, voice: { file_id: 'v' } })));
    expect(tg.calls).toEqual([]);
    expect(soniox.calls).toEqual([]);
  });
  it('3 ignores messages without from', async () => {
    const { deps, tg } = makeDeps();
    await handleUpdate(deps, upd(msg({ from: undefined, text: '/start' })));
    expect(tg.calls).toEqual([]);
  });
  it('4 rejects users outside the allow list', async () => {
    const { deps, tg, soniox } = makeDeps({ env: { ALLOWED_USER_IDS: '1' } });
    await handleUpdate(deps, upd(msg({ from: { id: 2 }, voice: { file_id: 'v' } })));
    expect(tg.calls).toEqual([{ method: 'sendMessage', args: [CHAT, deps.s.notAllowed(2), { replyTo: 10 }] }]);
    expect(soniox.calls).toEqual([]);
  });
  it('4b rejects a locked-out stranger sending a link before any preflight', async () => {
    const { deps, tg, soniox } = makeDeps({ env: { ALLOWED_USER_IDS: '1' } });
    const preflight = okPreflight();
    await handleUpdate(deps, upd(msg({ from: { id: 2 }, text: 'https://example.com/a.mp3' })), { preflight });
    expect(tg.calls).toEqual([{ method: 'sendMessage', args: [CHAT, deps.s.notAllowed(2), { replyTo: 10 }] }]);
    expect(preflight).not.toHaveBeenCalled();
    expect(soniox.calls).toEqual([]);
  });
  it('5 /start sends welcome then the open warning', async () => {
    const { deps, tg } = makeDeps();
    await handleUpdate(deps, upd(msg({ text: '/start' })));
    expect(sent(tg).map((c) => c.args[1])).toEqual([deps.s.welcome, deps.s.openWarning(USER)]);
  });
  it('6 /start when locked and allowed sends welcome only', async () => {
    const { deps, tg } = makeDeps({ env: { ALLOWED_USER_IDS: '1' } });
    await handleUpdate(deps, upd(msg({ text: '/start@my_bot' })));
    expect(sent(tg).map((c) => c.args[1])).toEqual([deps.s.welcome]);
  });
  it('7 /help reflects the summarizer', async () => {
    const a = makeDeps();
    await handleUpdate(a.deps, upd(msg({ text: '/help' })));
    expect(lastText(a.tg)).toBe(a.deps.s.help(false));
    const b = makeDeps({ summarizer: summarizer() });
    await handleUpdate(b.deps, upd(msg({ text: '/help extra' })));
    expect(lastText(b.tg)).toBe(b.deps.s.help(true));
  });
  it('8 /id sends the user id', async () => {
    const { deps, tg } = makeDeps();
    await handleUpdate(deps, upd(msg({ text: '/id' })));
    expect(lastText(tg)).toBe(deps.s.yourId(USER));
  });
});

describe('handleUpdate media', () => {
  it('9 starts a file job with the status message as ref', async () => {
    const { deps, tg, soniox } = makeDeps();
    await handleUpdate(deps, upd(msg({ voice: { file_id: 'v', file_size: 100 } })));
    expect(sent(tg)).toHaveLength(1); // no open warning at job start
    expect(sent(tg)[0]?.args).toEqual([CHAT, deps.s.transcribing, { replyTo: 10 }]);
    const call = soniox.calls.find((c) => c.method === 'startFromFile');
    expect(call?.args[0].ref).toBe(encodeRef({ chatId: CHAT, replyTo: 10, statusMessageId: 100, mode: 't' }));
    expect(call?.args[0].filename).toBe('voice.ogg');
    expect(deps.log.info).toHaveBeenCalledWith('job_started', { kind: 'file', mode: 't' });
  });
  it('10 caption asking for a summary gives mode s with a summarizer', async () => {
    const { deps, soniox } = makeDeps({ summarizer: summarizer() });
    await handleUpdate(deps, upd(msg({ voice: { file_id: 'v' }, caption: 'סיכום' })));
    expect(soniox.calls[0]?.args[0].ref.endsWith('|s')).toBe(true);
  });
  it('11 same caption without a summarizer gives mode t', async () => {
    const { deps, tg, soniox } = makeDeps();
    await handleUpdate(deps, upd(msg({ voice: { file_id: 'v' }, caption: 'סיכום' })));
    expect(soniox.calls[0]?.args[0].ref.endsWith('|t')).toBe(true);
    expect(sent(tg).map((c) => c.args[1]).join('\n')).not.toMatch(/סיכום|סכם/);
  });
  it('12 rejects oversize files before anything is downloaded', async () => {
    const { deps, tg } = makeDeps();
    await handleUpdate(deps, upd(msg({ audio: { file_id: 'a', file_size: 21 * 1024 * 1024 } })));
    expect(lastText(tg)).toBe(deps.s.tooLarge);
    expect(tg.calls.some((c) => c.method === 'getFileStream')).toBe(false);
  });
  it('13 maps "file is too big" from Telegram', async () => {
    const { deps, tg } = makeDeps();
    tg.handlers.getFileStream = () => Promise.reject(new TelegramApiError(400, 'Bad Request: file is too big'));
    await handleUpdate(deps, upd(msg({ audio: { file_id: 'a' } })));
    expect(methods(tg)).toEqual(['sendMessage', 'getFileStream', 'deleteMessage', 'sendMessage']);
    expect(tg.calls.some((c) => c.method === 'deleteMessage' && c.args[1] === 100)).toBe(true);
    expect(lastText(tg)).toBe(deps.s.tooLarge);
  });
  it('14 maps a Soniox payment failure', async () => {
    const { deps, tg, soniox } = makeDeps();
    soniox.handlers.startFromFile = () => Promise.reject(new SonioxStartError('payment'));
    await handleUpdate(deps, upd(msg({ voice: { file_id: 'v' } })));
    expect(methods(tg)).toEqual(['sendMessage', 'getFileStream', 'deleteMessage', 'sendMessage']);
    expect(lastText(tg)).toBe(deps.s.sonioxPayment);
  });
  it('15 maps any other Soniox failure', async () => {
    const { deps, tg, soniox } = makeDeps();
    soniox.handlers.startFromFile = () => Promise.reject(new SonioxStartError('other'));
    await handleUpdate(deps, upd(msg({ voice: { file_id: 'v' } })));
    expect(methods(tg)).toEqual(['sendMessage', 'getFileStream', 'deleteMessage', 'sendMessage']);
    expect(lastText(tg)).toBe(deps.s.sonioxFailed);
  });
  it('9b passes the webhook base on to the file job', async () => {
    const { deps, soniox } = makeDeps();
    await handleUpdate(deps, upd(msg({ voice: { file_id: 'v' } })), { webhookBase: 'https://alias.vercel.app' });
    expect(soniox.calls.find((c) => c.method === 'startFromFile')?.args[0].webhookBase).toBe('https://alias.vercel.app');
  });
  it('27 calls afterStart with the job id', async () => {
    const afterStart = vi.fn();
    const { deps } = makeDeps({ afterStart });
    await handleUpdate(deps, upd(msg({ voice: { file_id: 'v' } })));
    expect(afterStart).toHaveBeenCalledWith('job-1');
  });
  it.each(['file', 'link'] as const)('27b a throwing afterStart (%s) is logged and the user sees no error', async (kind) => {
    const afterStart = vi.fn(() => {
      throw new Error('hook');
    });
    const { deps, tg } = makeDeps({ afterStart });
    const message = kind === 'file' ? msg({ voice: { file_id: 'v' } }) : msg({ text: 'https://example.com/a.mp3' });
    await expect(handleUpdate(deps, upd(message), { preflight: okPreflight() })).resolves.toBeUndefined();
    expect(sent(tg).map((c) => c.args[1])).toEqual([deps.s.transcribing]);
    expect(methods(tg)).not.toContain('deleteMessage');
    expect(deps.log.info).toHaveBeenCalledWith('job_started', { kind, mode: 't' });
    expect(deps.log.error).toHaveBeenCalledWith('after_start_failed', { error: 'Error' });
    expect(deps.log.error).not.toHaveBeenCalledWith('job_start_failed', expect.anything());
  });
});

describe('handleUpdate links', () => {
  it('16 starts a link job from the preflight final URL', async () => {
    const { deps, tg, soniox } = makeDeps();
    const preflight = okPreflight();
    await handleUpdate(deps, upd(msg({ text: 'https://drive.google.com/file/d/abcdefghij1234/view' })), { preflight });
    expect(preflight).toHaveBeenCalledWith(
      'https://drive.usercontent.google.com/download?id=abcdefghij1234&export=download&confirm=t',
    );
    expect(sent(tg)[0]?.args[1]).toBe(deps.s.transcribing);
    const call = soniox.calls.find((c) => c.method === 'startFromUrl');
    expect(call?.args[0].url).toBe('https://cdn/x');
    expect(call?.args[0].ref).toBe(encodeRef({ chatId: CHAT, replyTo: 10, statusMessageId: 100, mode: 't' }));
  });
  it('16b passes the webhook base on to the link job', async () => {
    const { deps, soniox } = makeDeps();
    await handleUpdate(deps, upd(msg({ text: 'https://example.com/a.mp3' })), {
      preflight: okPreflight(),
      webhookBase: 'https://alias.vercel.app',
    });
    expect(soniox.calls.find((c) => c.method === 'startFromUrl')?.args[0].webhookBase).toBe('https://alias.vercel.app');
  });
  it('17 rejects YouTube without a status message or preflight', async () => {
    const { deps, tg } = makeDeps();
    const preflight = okPreflight();
    await handleUpdate(deps, upd(msg({ text: 'https://youtu.be/abc' })), { preflight });
    expect(sent(tg).map((c) => c.args[1])).toEqual([deps.s.linkRejected('youtube-unsupported')]);
    expect(preflight).not.toHaveBeenCalled();
  });
  it('18 not-media preflight', async () => {
    const { deps, tg, soniox } = makeDeps();
    const preflight = vi.fn().mockResolvedValue({ ok: false, reason: 'not-media' });
    await handleUpdate(deps, upd(msg({ text: 'https://example.com/a' })), { preflight });
    expect(tg.calls.some((c) => c.method === 'deleteMessage')).toBe(true);
    expect(lastText(tg)).toBe(deps.s.linkNotMedia);
    expect(soniox.calls).toEqual([]);
  });
  it('19 other preflight failures', async () => {
    const { deps, tg } = makeDeps();
    const preflight = vi.fn().mockResolvedValue({ ok: false, reason: 'fetch-failed' });
    await handleUpdate(deps, upd(msg({ text: 'https://example.com/a' })), { preflight });
    expect(lastText(tg)).toBe(deps.s.linkFetchFailed);
  });
  it('19b a preflight failure whose reply fails deletes the status once and is not a start failure', async () => {
    const { deps, tg, soniox } = makeDeps();
    tg.handlers.sendMessage = onlyFirstSendSucceeds();
    const preflight = vi.fn().mockResolvedValue({ ok: false, reason: 'not-media' });
    await expect(handleUpdate(deps, upd(msg({ text: 'https://example.com/a' })), { preflight })).resolves.toBeUndefined();
    expect(tg.calls.filter((c) => c.method === 'deleteMessage')).toHaveLength(1);
    expect(sent(tg)[1]?.args[1]).toBe(deps.s.linkNotMedia);
    expect(deps.log.error).not.toHaveBeenCalledWith('job_start_failed', expect.anything());
    expect(soniox.calls).toEqual([]);
  });
  it('link message asks for a summary in mode s', async () => {
    const { deps, soniox } = makeDeps({ summarizer: summarizer() });
    await handleUpdate(deps, upd(msg({ text: 'תסכם https://example.com/a.mp3' })), { preflight: okPreflight() });
    expect(soniox.calls[0]?.args[0].ref.endsWith('|s')).toBe(true);
  });
  it('a summary word inside the link itself does not ask for a summary', async () => {
    const { deps, soniox } = makeDeps({ summarizer: summarizer() });
    await handleUpdate(deps, upd(msg({ text: 'https://host.example/meeting-summary.mp3' })), { preflight: okPreflight() });
    expect(soniox.calls[0]?.args[0].ref.endsWith('|t')).toBe(true);
  });
  it('"סכם" next to a link whose name mentions a summary still asks for one', async () => {
    const { deps, soniox } = makeDeps({ summarizer: summarizer() });
    await handleUpdate(deps, upd(msg({ text: 'סכם https://host.example/meeting-summary.mp3' })), { preflight: okPreflight() });
    expect(soniox.calls[0]?.args[0].ref.endsWith('|s')).toBe(true);
  });
  it('20 plain text is unsupported', async () => {
    const { deps, tg } = makeDeps();
    await handleUpdate(deps, upd(msg({ text: 'שלום' })));
    expect(lastText(tg)).toBe(deps.s.unsupported);
  });
});

describe('handleUpdate summary callback', () => {
  const textMsg = (extra: Partial<TgMessage> = {}) => msg({ message_id: 77, text: 'שלום\n\n⏱ 0:12', ...extra });

  it('21 summarizes the message text without its footer', async () => {
    const s = summarizer();
    const { deps, tg } = makeDeps({ summarizer: s });
    await handleUpdate(deps, callback(textMsg()));
    expect(tg.calls[0]).toEqual({ method: 'answerCallbackQuery', args: ['cb1', deps.s.summarizing] });
    expect(s.summarize).toHaveBeenCalledWith('שלום');
    expect(sent(tg)[0]?.args[2]).toEqual({ replyTo: 77 });
    expect(tg.calls.some((c) => c.method === 'removeKeyboard' && c.args[0] === CHAT && c.args[1] === 77)).toBe(true);
  });
  it('21b a failed callback answer (query too old) is logged and the summary still runs', async () => {
    const s = summarizer();
    const { deps, tg } = makeDeps({ summarizer: s });
    tg.handlers.answerCallbackQuery = () =>
      Promise.reject(new TelegramApiError(400, 'Bad Request: query is too old and response timeout expired or query ID is invalid'));
    await handleUpdate(deps, callback(textMsg()));
    expect(s.summarize).toHaveBeenCalledWith('שלום');
    expect(sent(tg).map((c) => c.args[1])).not.toContain(deps.s.genericError);
    expect(tg.calls.some((c) => c.method === 'removeKeyboard')).toBe(true);
    expect(deps.log.error).toHaveBeenCalledWith('callback_answer_failed', { error: 'TelegramApiError' });
    expect(deps.log.error).not.toHaveBeenCalledWith('update_failed', expect.anything());
  });
  it('22 summarizes a downloaded document as is', async () => {
    const s = summarizer();
    const { deps, tg } = makeDeps({ summarizer: s });
    tg.handlers.downloadText = async () => 'תוכן\n\n⏱ 0:05 אמיתי';
    await handleUpdate(deps, callback(textMsg({ text: undefined, document: { file_id: 'doc1' } })));
    expect(tg.calls.some((c) => c.method === 'downloadText' && c.args[0] === 'doc1')).toBe(true);
    expect(s.summarize).toHaveBeenCalledWith('תוכן\n\n⏱ 0:05 אמיתי');
  });
  it('23 failed summary keeps the keyboard', async () => {
    const s: Summarizer = { summarize: vi.fn().mockRejectedValue(new Error('boom')) };
    const { deps, tg } = makeDeps({ summarizer: s });
    await handleUpdate(deps, callback(textMsg()));
    expect(lastText(tg)).toBe(deps.s.summaryFailed);
    expect(tg.calls.some((c) => c.method === 'removeKeyboard')).toBe(false);
  });
  it('24 old or missing message tells the user', async () => {
    for (const message of [undefined, textMsg({ date: 0 })]) {
      const { deps, tg } = makeDeps({ summarizer: summarizer() });
      await handleUpdate(deps, callback(message));
      expect(sent(tg)).toEqual([{ method: 'sendMessage', args: [USER, deps.s.messageTooOld] }]);
    }
  });
  it('25 locked and not allowed only answers the callback', async () => {
    const { deps, tg } = makeDeps({ summarizer: summarizer(), env: { ALLOWED_USER_IDS: '9' } });
    await handleUpdate(deps, callback(textMsg()));
    expect(tg.calls).toEqual([{ method: 'answerCallbackQuery', args: ['cb1'] }]);
  });
  it('logs access_denied for a locked-out message, with the kind only', async () => {
    const { deps } = makeDeps({ env: { ALLOWED_USER_IDS: '1' } });
    await handleUpdate(deps, upd(msg({ from: { id: 2 }, text: 'secret words' })));
    expect(deps.log.info).toHaveBeenCalledWith('access_denied', { kind: 'message' });
  });
  it('logs access_denied for a locked-out callback, with the kind only', async () => {
    const { deps } = makeDeps({ summarizer: summarizer(), env: { ALLOWED_USER_IDS: '9' } });
    await handleUpdate(deps, callback(textMsg()));
    expect(deps.log.info).toHaveBeenCalledWith('access_denied', { kind: 'callback' });
  });
  it('26 without a summarizer only answers the callback', async () => {
    const { deps, tg } = makeDeps();
    await handleUpdate(deps, callback(textMsg()));
    expect(tg.calls).toEqual([{ method: 'answerCallbackQuery', args: ['cb1'] }]);
  });
  it('unknown callback data only answers the callback', async () => {
    const { deps, tg } = makeDeps({ summarizer: summarizer() });
    await handleUpdate(deps, callback(textMsg(), 'other'));
    expect(tg.calls).toEqual([{ method: 'answerCallbackQuery', args: ['cb1'] }]);
  });
  it('empty source says the message is too old', async () => {
    const { deps, tg } = makeDeps({ summarizer: summarizer() });
    await handleUpdate(deps, callback(textMsg({ text: undefined })));
    expect(lastText(tg)).toBe(deps.s.messageTooOld);
  });
});

describe('handleUpdate failure containment', () => {
  it('28 never throws and logs only the error class', async () => {
    const { deps, tg } = makeDeps();
    tg.handlers.sendMessage = () => Promise.reject(new Error('secret message text'));
    await expect(handleUpdate(deps, upd(msg({ text: 'שלום' })))).resolves.toBeUndefined();
    expect(deps.log.error).toHaveBeenCalledWith('update_failed', { error: 'Error' });
    expect(deps.log.error).toHaveBeenCalledWith('update_reply_failed', { error: 'Error' });
    expect(JSON.stringify(vi.mocked(deps.log.error).mock.calls)).not.toContain('secret');
  });
  it('29 resolves on a null update', async () => {
    const { deps, tg } = makeDeps();
    await expect(handleUpdate(deps, null as unknown as TgUpdate)).resolves.toBeUndefined();
    expect(tg.calls).toEqual([]);
  });
  it('30 resolves on a message without a chat', async () => {
    const { deps, tg } = makeDeps();
    await expect(handleUpdate(deps, { update_id: 1, message: {} } as unknown as TgUpdate)).resolves.toBeUndefined();
    expect(tg.calls).toEqual([]);
    expect(deps.log.error).toHaveBeenCalledWith('update_failed', { error: 'TypeError' });
  });
  it('31 sends nothing to a group when answering its callback fails', async () => {
    const { deps, tg } = makeDeps({ summarizer: summarizer() });
    tg.handlers.answerCallbackQuery = () => Promise.reject(new Error('boom'));
    const group = msg({ chat: { id: -5, type: 'group' }, text: 'x' });
    await expect(handleUpdate(deps, callback(group))).resolves.toBeUndefined();
    expect(sent(tg)).toEqual([]);
    // Answering a callback is best effort (D1), so the failure is logged and nothing else happens.
    expect(deps.log.error).toHaveBeenCalledWith('callback_answer_failed', { error: 'Error' });
  });
  it('32 only logs when the refusal to a stranger fails', async () => {
    const { deps, tg } = makeDeps({ env: { ALLOWED_USER_IDS: '1' } });
    tg.handlers.sendMessage = () => Promise.reject(new Error('boom'));
    await expect(handleUpdate(deps, upd(msg({ from: { id: 2 }, text: 'שלום' })))).resolves.toBeUndefined();
    expect(sent(tg).map((c) => c.args[1])).toEqual([deps.s.notAllowed(2)]);
    expect(deps.log.error).toHaveBeenCalledWith('update_failed', { error: 'Error' });
  });
  it('33 only logs when answering a locked-out callback fails', async () => {
    const { deps, tg } = makeDeps({ summarizer: summarizer(), env: { ALLOWED_USER_IDS: '9' } });
    tg.handlers.answerCallbackQuery = () => Promise.reject(new Error('boom'));
    await expect(handleUpdate(deps, callback(msg({ text: 'x' })))).resolves.toBeUndefined();
    expect(sent(tg)).toEqual([]);
  });
  it('34 sends the generic error to the user when a callback on an old message fails', async () => {
    const { deps, tg } = makeDeps({ summarizer: summarizer() });
    let n = 0;
    tg.handlers.sendMessage = async () => {
      if (++n === 1) throw new Error('boom');
      return { message_id: 5 };
    };
    await handleUpdate(deps, callback(msg({ chat: { id: -5, type: 'group' }, date: 0 })));
    expect(sent(tg).map((c) => c.args)).toEqual([
      [USER, deps.s.messageTooOld],
      [USER, deps.s.genericError],
    ]);
  });
});
