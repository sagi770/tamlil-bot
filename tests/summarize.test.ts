import { SUMMARY_MAX_INPUT_CHARS, createSummarizer } from '../src/summarize.js';

const reply = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

it('is null without a key', () => expect(createSummarizer({ openaiApiKey: null, openaiModel: 'm' })).toBeNull());
it('sends the model, a system prompt and the transcript', async () => {
  const fetchImpl = vi.fn().mockResolvedValue(reply('סיכום'));
  const s = createSummarizer({ openaiApiKey: 'k', openaiModel: 'm' }, fetchImpl as unknown as typeof fetch)!;
  expect(await s.summarize('תמליל')).toEqual({ text: 'סיכום', truncated: false });
  const [url, init] = fetchImpl.mock.calls[0];
  expect(url).toBe('https://api.openai.com/v1/chat/completions');
  expect(init.headers.authorization).toBe('Bearer k');
  const body = JSON.parse(init.body);
  expect(body.model).toBe('m');
  expect(body.messages[0].role).toBe('system');
  expect(body.messages[1]).toEqual({ role: 'user', content: 'תמליל' });
  expect(body).not.toHaveProperty('temperature');
  expect(body).not.toHaveProperty('max_tokens');
});
it('trims the answer', async () => {
  const s = createSummarizer({ openaiApiKey: 'k', openaiModel: 'm' }, vi.fn().mockResolvedValue(reply('  hi \n')) as unknown as typeof fetch)!;
  expect((await s.summarize('x')).text).toBe('hi');
});
it('truncates an over-long transcript and says so', async () => {
  const fetchImpl = vi.fn().mockResolvedValue(reply('x'));
  const s = createSummarizer({ openaiApiKey: 'k', openaiModel: 'm' }, fetchImpl as unknown as typeof fetch)!;
  const result = await s.summarize('א'.repeat(SUMMARY_MAX_INPUT_CHARS + 10));
  expect(result.truncated).toBe(true);
  expect(JSON.parse(fetchImpl.mock.calls[0][1].body).messages[1].content).toHaveLength(SUMMARY_MAX_INPUT_CHARS);
});
it('does not split a surrogate pair when truncating', async () => {
  const fetchImpl = vi.fn().mockResolvedValue(reply('x'));
  const s = createSummarizer({ openaiApiKey: 'k', openaiModel: 'm' }, fetchImpl as unknown as typeof fetch)!;
  await s.summarize('א'.repeat(SUMMARY_MAX_INPUT_CHARS - 1) + '😀' + 'ב');
  const sent: string = JSON.parse(fetchImpl.mock.calls[0][1].body).messages[1].content;
  expect(sent).toHaveLength(SUMMARY_MAX_INPUT_CHARS - 1);
});
it('does not truncate a transcript of exactly the limit', async () => {
  const s = createSummarizer({ openaiApiKey: 'k', openaiModel: 'm' }, vi.fn().mockResolvedValue(reply('x')) as unknown as typeof fetch)!;
  expect((await s.summarize('א'.repeat(SUMMARY_MAX_INPUT_CHARS))).truncated).toBe(false);
});
it('throws on an API error without echoing the key', async () => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response('{"error":{"message":"bad"}}', { status: 401 }));
  const s = createSummarizer({ openaiApiKey: 'secret-key', openaiModel: 'm' }, fetchImpl as unknown as typeof fetch)!;
  await expect(s.summarize('x')).rejects.toSatisfy((e: Error) => !e.message.includes('secret-key') && e.message.includes('401'));
});
it('throws a fixed message on a network failure', async () => {
  const fetchImpl = vi.fn().mockRejectedValue(new Error('connect failed secret-key תמליל'));
  const s = createSummarizer({ openaiApiKey: 'secret-key', openaiModel: 'm' }, fetchImpl as unknown as typeof fetch)!;
  await expect(s.summarize('תמליל')).rejects.toSatisfy((e: Error) => !e.message.includes('secret-key') && !e.message.includes('תמליל'));
});
it('throws on malformed JSON', async () => {
  const s = createSummarizer({ openaiApiKey: 'k', openaiModel: 'm' }, vi.fn().mockResolvedValue(new Response('not json', { status: 200 })) as unknown as typeof fetch)!;
  await expect(s.summarize('x')).rejects.toThrow();
});
it('throws on an empty or whitespace answer', async () => {
  for (const c of ['', '  \n ']) {
    const s = createSummarizer({ openaiApiKey: 'k', openaiModel: 'm' }, vi.fn().mockResolvedValue(reply(c)) as unknown as typeof fetch)!;
    await expect(s.summarize('x')).rejects.toThrow();
  }
});

const mk = (res: Response) => createSummarizer({ openaiApiKey: 'k', openaiModel: 'm' }, vi.fn().mockResolvedValue(res) as unknown as typeof fetch)!;
const json = (choice: object) => new Response(JSON.stringify({ choices: [choice] }), { status: 200 });

it('throws "cut off" when finish_reason is length, with or without content', async () => {
  await expect(mk(json({ message: { content: 'partial' }, finish_reason: 'length' })).summarize('x')).rejects.toThrow('OpenAI summary was cut off');
  await expect(mk(json({ message: { content: '' }, finish_reason: 'length' })).summarize('x')).rejects.toThrow('OpenAI summary was cut off');
});
it('throws a refusal error when refusal is a non-empty string', async () => {
  await expect(mk(json({ message: { content: null, refusal: 'no' }, finish_reason: 'stop' })).summarize('x')).rejects.toThrow('OpenAI refused to summarize');
});
it('keeps the empty-summary error for other empty answers', async () => {
  await expect(mk(json({ message: { content: '', refusal: '' }, finish_reason: 'stop' })).summarize('x')).rejects.toThrow('OpenAI returned an empty summary');
});
it('appends a safe error code and param on a non-2xx response', async () => {
  const body = { error: { message: 'bad sk-proj-abc123', code: 'unsupported_parameter', param: 'reasoning_effort' } };
  const err = await mk(new Response(JSON.stringify(body), { status: 400 })).summarize('x').catch((e: Error) => e);
  expect((err as Error).message).toBe('OpenAI request failed with HTTP 400 (code=unsupported_parameter, param=reasoning_effort)');
  expect((err as Error).message).not.toContain('sk-proj');
});
it('omits an unsafe code and param', async () => {
  const body = { error: { message: 'key sk-proj-abc123', code: 'has spaces', param: 'a'.repeat(200) } };
  const err = await mk(new Response(JSON.stringify(body), { status: 400 })).summarize('x').catch((e: Error) => e);
  expect((err as Error).message).toBe('OpenAI request failed with HTTP 400');
});

it('uses a 120s abort signal and reports a timeout with a fixed message', async () => {
  const fetchImpl = vi.fn(
    (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'TimeoutError')));
      }),
  );
  const original = AbortSignal.timeout.bind(AbortSignal);
  const spy = vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => original(20));
  const s = createSummarizer({ openaiApiKey: 'k', openaiModel: 'm' }, fetchImpl as unknown as typeof fetch)!;
  await expect(s.summarize('x')).rejects.toThrow('OpenAI request timed out');
  expect(spy).toHaveBeenCalledWith(120_000);
  spy.mockRestore();
});

it('tells the model to omit empty sections', async () => {
  const fetchImpl = vi.fn().mockResolvedValue(reply('x'));
  const s = createSummarizer({ openaiApiKey: 'k', openaiModel: 'm' }, fetchImpl as unknown as typeof fetch)!;
  await s.summarize('t');
  const system = JSON.parse(fetchImpl.mock.calls[0][1].body).messages[0].content as string;
  expect(system).toContain('omit that heading and section entirely');
  expect(system).toContain('never write that there are none');
});
