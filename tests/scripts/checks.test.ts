import {
  accessLine,
  accessWords,
  checkAllowedUserIds,
  checkEndpoints,
  checkTelegramBot,
  lockHint,
} from '../../scripts/lib/checks.js';
import { StepFailure } from '../../scripts/lib/report.js';
import { createTelegramAdmin } from '../../scripts/lib/telegram-admin.js';
import { loadConfig } from '../../src/config.js';

const env = { TELEGRAM_BOT_TOKEN: 't', SONIOX_API_KEY: 's', TELEGRAM_WEBHOOK_SECRET: 'a', SONIOX_WEBHOOK_SECRET: 'b' };

describe('checkTelegramBot', () => {
  it('turns a network failure into a "check your internet connection" hint', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const admin = createTelegramAdmin('t', fetchImpl as never);
    await expect(checkTelegramBot(admin)).rejects.toMatchObject({
      name: 'StepFailure',
      hint: 'check your internet connection, then run again',
    });
  });

  it('passes other errors through', async () => {
    const admin = {
      getMe: async () => {
        throw new Error('weird');
      },
    } as never;
    await expect(checkTelegramBot(admin)).rejects.toThrow('weird');
  });
});

describe('accessLine / accessWords', () => {
  const open = { allowedUserIds: [], invalidUserIds: [], allowAllUsers: false } as never;
  it('accessLine has no owner-id hint in open-warn mode', () => {
    expect(accessLine(open)).toContain('OPEN TO EVERYONE');
    expect(accessLine(open)).not.toContain('--owner-id');
  });
  it('says when the open bot warns', () => {
    expect(accessLine(open)).toBe('OPEN TO EVERYONE, with a warning after /start and after every transcript');
  });
  it('accessWords keeps the hint', () => {
    expect(accessWords(open, 'my_bot')).toContain('--owner-id');
  });
  it('describes a lock', () => {
    expect(accessLine(loadConfig({ ...env, ALLOWED_USER_IDS: '123' }))).toBe('locked to one Telegram user: 123');
    expect(accessLine(loadConfig({ ...env, ALLOWED_USER_IDS: '1,2' }))).toBe('locked to 2 Telegram users: 1, 2');
  });
  it('describes a lock whose entries are all invalid, and names them', () => {
    const line = accessLine(loadConfig({ ...env, ALLOWED_USER_IDS: '@user' }));
    expect(line).toMatch(/^locked to nobody/);
    expect(line).toContain('@user');
  });
  it('names the ignored entries of a mixed list', () => {
    expect(accessLine(loadConfig({ ...env, ALLOWED_USER_IDS: '123 @bob' }))).toBe(
      'locked to one Telegram user: 123 (ignored, not Telegram IDs: @bob)',
    );
  });
});

describe('lockHint', () => {
  it('matches the open warning: the line goes into .env.local, then setup', () => {
    expect(lockHint('my_bot')).toContain('--owner-id=<ID>');
    expect(lockHint('my_bot')).toContain('add the line ALLOWED_USER_IDS=<ID> to .env.local and run `npm run setup`');
  });
});

describe('checkEndpoints', () => {
  const ours = () => new Response('unauthorized', { status: 401, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const protectedPage = () =>
    new Response('<!doctype html><html><title>Authentication Required</title></html>', {
      status: 401,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  const routed = (soniox: () => Response, telegram: () => Response = ours) => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return String(url).endsWith('/api/soniox') ? soniox() : telegram();
    });
    return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
  };
  const failureOf = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      return e as StepFailure;
    }
    throw new Error('expected a failure');
  };

  it('passes when both endpoints refuse a request without the secret, probing Telegram first', async () => {
    const { fetchImpl, calls } = routed(ours);
    await expect(checkEndpoints('https://bot.example', fetchImpl)).resolves.toBeUndefined();
    expect(calls.map((c) => c.url)).toEqual(['https://bot.example/api/telegram', 'https://bot.example/api/soniox']);
    for (const { init } of calls) {
      expect(init?.method).toBe('POST');
      expect(Object.keys((init?.headers ?? {}) as Record<string, string>)).toEqual(['content-type']);
    }
  });
  it('fails with the Deployment Protection hint when /api/soniox is protected', async () => {
    const f = await failureOf(checkEndpoints('https://bot.example', routed(protectedPage).fetchImpl));
    expect(f).toBeInstanceOf(StepFailure);
    expect(f.message).toContain('Soniox cannot call a protected URL');
    expect(f.hint).toContain('Deployment Protection');
  });
  it('names Telegram when /api/telegram is protected', async () => {
    const f = await failureOf(checkEndpoints('https://bot.example', routed(ours, protectedPage).fetchImpl));
    expect(f.message).toContain('Telegram cannot call a protected URL');
  });
  it('fails on any other answer from /api/soniox', async () => {
    const missing = await failureOf(checkEndpoints('https://bot.example', routed(() => new Response('nope', { status: 404 })).fetchImpl));
    expect(missing.message).toContain('https://bot.example/api/soniox does not exist (HTTP 404)');
    const odd = await failureOf(checkEndpoints('https://bot.example', routed(() => new Response('ok', { status: 200 })).fetchImpl));
    expect(odd.message).toContain('https://bot.example/api/soniox');
    expect(odd.message).toContain('HTTP 200');
  });
  it('fails when /api/soniox cannot be reached', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/api/soniox')) throw new TypeError('fetch failed');
      return ours();
    }) as unknown as typeof fetch;
    const f = await failureOf(checkEndpoints('https://bot.example', fetchImpl));
    expect(f.message).toBe('https://bot.example/api/soniox could not be reached');
  });
});

describe('checkAllowedUserIds', () => {
  it('passes a valid list and an empty one', () => {
    expect(() => checkAllowedUserIds(loadConfig({ ...env, ALLOWED_USER_IDS: '123456789,987654321' }))).not.toThrow();
    expect(() => checkAllowedUserIds(loadConfig(env))).not.toThrow();
  });
  it('fails naming the bad entries and the expected format', () => {
    for (const raw of ['123456789 @user', '123;456', '@user']) {
      let failure: unknown;
      try {
        checkAllowedUserIds(loadConfig({ ...env, ALLOWED_USER_IDS: raw }));
      } catch (e) {
        failure = e;
      }
      expect(failure).toBeInstanceOf(StepFailure);
      const { message, hint } = failure as StepFailure;
      for (const bad of raw.split(/[\s,]+/).filter((s) => !/^\d+$/.test(s))) expect(message).toContain(bad);
      expect(hint).toContain('ALLOWED_USER_IDS=123456789,987654321');
    }
  });
  it('says the bot stays locked to the valid ids, or to nobody', () => {
    const fail = (raw: string) => {
      try {
        checkAllowedUserIds(loadConfig({ ...env, ALLOWED_USER_IDS: raw }));
      } catch (e) {
        return e as StepFailure;
      }
      throw new Error('expected a failure');
    };
    expect(fail('123 @user').message).toContain('locked to 123 only');
    expect(fail('@user').message).toContain('nobody can use it');
  });
});
