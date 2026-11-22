import { TELEGRAM_MESSAGE_LIMIT, TelegramApiError, createTelegramClient, splitForTelegram } from '../src/telegram.js';

const ok = (result: unknown) => new Response(JSON.stringify({ ok: true, result }), { status: 200 });
const fail = (code: number, description: string) =>
  new Response(JSON.stringify({ ok: false, error_code: code, description }), { status: code });
const client = (f: unknown) => createTelegramClient('TOKEN', f as typeof fetch);

describe('telegram client', () => {
  it('sends plain text with a reply and a keyboard, and no parse_mode', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ message_id: 9 }));
    const kb = [[{ text: 'x', callback_data: 'sum' }]];
    expect(await client(fetchImpl).sendMessage(5, 'hi', { replyTo: 3, keyboard: kb })).toEqual({ message_id: 9 });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/botTOKEN/sendMessage');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      chat_id: 5,
      text: 'hi',
      reply_parameters: { message_id: 3, allow_sending_without_reply: true },
      reply_markup: { inline_keyboard: kb },
    });
    expect(body).not.toHaveProperty('parse_mode');
  });

  it('throws TelegramApiError with code and description', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fail(400, 'Bad Request: file is too big'));
    await expect(client(fetchImpl).getFileStream('f')).rejects.toMatchObject({
      code: 400,
      description: 'Bad Request: file is too big',
    });
  });

  it('never puts the token in an error message', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new Error('connect ECONNRESET https://api.telegram.org/botTOKEN/sendMessage'));
    await expect(client(fetchImpl).sendMessage(1, 'x')).rejects.toSatisfy(
      (e: Error) => !e.message.includes('TOKEN') && e.message.includes('sendMessage'),
    );
  });

  it('throws a plain Error naming the method on a non-JSON response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('<html>', { status: 502 }));
    await expect(client(fetchImpl).sendMessage(1, 'x')).rejects.toThrow(/sendMessage/);
  });

  it('sends a long message in parts: reply on the first, keyboard on the last', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => ok({ message_id: 1 }));
    await client(fetchImpl).sendMessage(5, `${'א'.repeat(4000)}\n\n${'ב'.repeat(4000)}`, {
      replyTo: 3,
      keyboard: [[{ text: 'x', callback_data: 'sum' }]],
    });
    const bodies = fetchImpl.mock.calls.map((c) => JSON.parse(c[1].body));
    expect(bodies).toHaveLength(2);
    expect(bodies[0].reply_parameters).toBeDefined();
    expect(bodies[0].reply_markup).toBeUndefined();
    expect(bodies[1].reply_parameters).toBeUndefined();
    expect(bodies[1].reply_markup).toBeDefined();
  });

  it('uploads a document as UTF-8 text with its file name', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok({ message_id: 2 }));
    await client(fetchImpl).sendDocument(5, { name: 'תמליל.txt', content: 'שלום' }, { caption: '⏱ 0:12', replyTo: 4 });
    const form = fetchImpl.mock.calls[0][1].body as FormData;
    const file = form.get('document') as File;
    expect(file.name).toBe('תמליל.txt');
    expect(await file.text()).toBe('שלום');
    expect(form.get('caption')).toBe('⏱ 0:12');
    expect(form.get('chat_id')).toBe('5');
    expect(JSON.parse(form.get('reply_parameters') as string)).toEqual({
      message_id: 4,
      allow_sending_without_reply: true,
    });
  });

  it('deleteMessage and removeKeyboard swallow 400 but propagate other errors', async () => {
    await expect(
      client(vi.fn().mockResolvedValue(fail(400, 'message to delete not found'))).deleteMessage(1, 2),
    ).resolves.toBeUndefined();
    await expect(
      client(vi.fn().mockResolvedValue(fail(400, 'message is not modified'))).removeKeyboard(1, 2),
    ).resolves.toBeUndefined();
    await expect(
      client(vi.fn().mockResolvedValue(fail(403, 'forbidden'))).deleteMessage(1, 2),
    ).rejects.toBeInstanceOf(TelegramApiError);
  });

  it('removeKeyboard sends an empty inline keyboard', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok(true));
    await client(fetchImpl).removeKeyboard(1, 2);
    expect(fetchImpl.mock.calls[0][0]).toMatch(/editMessageReplyMarkup$/);
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      chat_id: 1,
      message_id: 2,
      reply_markup: { inline_keyboard: [] },
    });
  });

  it('answers a callback query', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok(true));
    await client(fetchImpl).answerCallbackQuery('cb1', 'hello');
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ callback_query_id: 'cb1', text: 'hello' });
  });

  it('downloads a file as text via getFile then the file URL', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(ok({ file_path: 'docs/a.txt' }))
      .mockResolvedValueOnce(new Response('שלום', { status: 200 }));
    expect(await client(fetchImpl).downloadText('fid')).toBe('שלום');
    expect(fetchImpl.mock.calls[1][0]).toBe('https://api.telegram.org/file/botTOKEN/docs/a.txt');
  });

  it('errors without leaking the URL when the download fails or file_path is missing', async () => {
    const bad = vi
      .fn()
      .mockResolvedValueOnce(ok({ file_path: 'x/y' }))
      .mockResolvedValueOnce(new Response('no', { status: 404 }));
    await expect(client(bad).getFileStream('f')).rejects.toSatisfy(
      (e: Error) => e.message.includes('getFile') && !e.message.includes('TOKEN') && !e.message.includes('x/y'),
    );
    await expect(client(vi.fn().mockResolvedValue(ok({}))).getFileStream('f')).rejects.toThrow(/getFile/);
  });
});

describe('splitForTelegram', () => {
  it('splits a long text on paragraph boundaries, each part within the limit', () => {
    const para = 'א'.repeat(3000);
    const parts = splitForTelegram(`${para}\n\n${para}\n\n${para}`);
    expect(parts).toHaveLength(3);
    expect(parts.every((p) => p.length <= TELEGRAM_MESSAGE_LIMIT)).toBe(true);
  });

  it('packs short paragraphs together', () => {
    expect(splitForTelegram('a\n\nb\n\nc', 10)).toEqual(['a\n\nb\n\nc']);
    expect(splitForTelegram('aaaa\n\nbbbb\n\ncccc', 10)).toEqual(['aaaa\n\nbbbb', 'cccc']);
  });

  it('hard-splits a single paragraph longer than the limit', () => {
    const parts = splitForTelegram('א'.repeat(9000));
    expect(parts.every((p) => p.length <= TELEGRAM_MESSAGE_LIMIT)).toBe(true);
    expect(parts.join('')).toBe('א'.repeat(9000));
  });

  it('splits an oversized paragraph on line breaks first', () => {
    expect(splitForTelegram('aaaa\nbbbb\ncccc', 9)).toEqual(['aaaa\nbbbb', 'cccc']);
  });

  it('never returns empty parts and does not split surrogate pairs', () => {
    expect(splitForTelegram('a\n\n\n\n\n\nb', 3).every((p) => p !== '')).toBe(true);
    const parts = splitForTelegram('😀'.repeat(10), 5);
    expect(parts.join('')).toBe('😀'.repeat(10));
    expect(parts.every((p) => !/[\ud800-\udbff]$/.test(p) && !/^[\udc00-\udfff]/.test(p))).toBe(true);
  });
});

describe('telegram hardening', () => {
  it.each(['\n\n\n\n', '   ', '\n'.repeat(5000)])('splitForTelegram returns [] for blank text %#', (t) => {
    expect(splitForTelegram(t)).toEqual([]);
  });
  it.each(['\n\n\n\n', '   ', '\n'.repeat(5000)])('sendMessage refuses blank text without calling fetch %#', async (t) => {
    const fetchImpl = vi.fn();
    await expect(client(fetchImpl).sendMessage(1, t)).rejects.toThrow('Telegram sendMessage: empty text');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('downloadText turns a stream read failure into a fixed error', async () => {
    const broken = new ReadableStream<Uint8Array>({
      start(c) {
        c.error(new Error('socket TOKEN reset'));
      },
    });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(ok({ file_path: 'x/y' }))
      .mockResolvedValueOnce(new Response(broken, { status: 200 }));
    const err = await client(fetchImpl).downloadText('f').catch((e: Error) => e);
    expect((err as Error).message).toBe('Telegram getFile download failed');
    expect((err as Error).cause).toBeUndefined();
  });
  it('cancels the body of a failed file download', async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const bad = { ok: false, status: 404, body: { cancel } } as unknown as Response;
    const fetchImpl = vi.fn().mockResolvedValueOnce(ok({ file_path: 'x/y' })).mockResolvedValueOnce(bad);
    await expect(client(fetchImpl).getFileStream('f')).rejects.toThrow('Telegram getFile download failed');
    expect(cancel).toHaveBeenCalled();
  });
  it('a throwing body cancel does not change the error', async () => {
    const bad = {
      ok: false,
      status: 404,
      body: {
        cancel: () => {
          throw new Error('nope');
        },
      },
    } as unknown as Response;
    const fetchImpl = vi.fn().mockResolvedValueOnce(ok({ file_path: 'x/y' })).mockResolvedValueOnce(bad);
    await expect(client(fetchImpl).getFileStream('f')).rejects.toThrow('Telegram getFile download failed');
  });
  it('errors carry no cause and no token on every failure path', async () => {
    const cases: unknown[] = [
      vi.fn().mockRejectedValue(new Error('connect botTOKEN')),
      vi.fn().mockResolvedValue(new Response('<html>botTOKEN', { status: 502 })),
      vi.fn().mockResolvedValueOnce(ok({ file_path: 'x/y' })).mockRejectedValueOnce(new Error('botTOKEN')),
    ];
    for (const f of cases) {
      const e = await client(f).getFileStream('f').catch((x: Error) => x);
      expect((e as Error).cause).toBeUndefined();
      expect((e as Error).message).not.toContain('TOKEN');
    }
    const jsonFail = await client(vi.fn().mockResolvedValue(new Response('<html>', { status: 502 })))
      .sendMessage(1, 'x')
      .catch((x: Error) => x);
    expect((jsonFail as Error).message).toBe('Telegram sendMessage returned an invalid response');
    expect((jsonFail as Error).cause).toBeUndefined();
  });
});
