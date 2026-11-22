import { accessMode, isAllowed } from '../src/access.js';
import { ConfigError, DEFAULT_OPENAI_MODEL, loadConfig } from '../src/config.js';

const base = { TELEGRAM_BOT_TOKEN: 't', SONIOX_API_KEY: 's', TELEGRAM_WEBHOOK_SECRET: 'a', SONIOX_WEBHOOK_SECRET: 'b' };

describe('loadConfig', () => {
  it('applies defaults', () => {
    const c = loadConfig(base);
    expect(c.sonioxModel).toBe('stt-async-v5');
    expect(DEFAULT_OPENAI_MODEL).toBe('gpt-6-luna');
    expect(c.openaiModel).toBe('gpt-6-luna');
    expect(c.languageHints).toEqual(['he', 'en']);
    expect(c.lang).toBe('he');
    expect(c.openaiApiKey).toBeNull();
    expect(c.sonioxContext).toBeNull();
    expect(c.allowedUserIds).toEqual([]);
    expect(c.invalidUserIds).toEqual([]);
    expect(c.allowAllUsers).toBe(false);
    expect(c.publicBaseUrl).toBeNull();
  });
  it('defaults the time zone by language', () => {
    expect(loadConfig(base).timeZone).toBe('Asia/Jerusalem');
    expect(loadConfig({ ...base, BOT_LANGUAGE: 'en' }).timeZone).toBe('UTC');
  });
  it('uses BOT_TIMEZONE when valid and falls back when not', () => {
    expect(loadConfig({ ...base, BOT_TIMEZONE: 'Europe/London' }).timeZone).toBe('Europe/London');
    expect(loadConfig({ ...base, BOT_TIMEZONE: 'Not/AZone' }).timeZone).toBe('Asia/Jerusalem');
    expect(loadConfig({ ...base, BOT_LANGUAGE: 'en', BOT_TIMEZONE: 'nope' }).timeZone).toBe('UTC');
  });
  it('reports every missing required variable at once', () => {
    try {
      loadConfig({});
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as ConfigError).missing).toEqual(['TELEGRAM_BOT_TOKEN', 'SONIOX_API_KEY', 'TELEGRAM_WEBHOOK_SECRET', 'SONIOX_WEBHOOK_SECRET']);
      expect((e as ConfigError).message).toContain('SONIOX_API_KEY');
    }
  });
  it('treats empty strings as missing and trims values', () => {
    expect(() => loadConfig({ ...base, TELEGRAM_BOT_TOKEN: '' })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, TELEGRAM_BOT_TOKEN: '   ' })).toThrow(ConfigError);
    expect(loadConfig({ ...base, TELEGRAM_BOT_TOKEN: ' tok ' }).telegramToken).toBe('tok');
  });
  it('does not require webhook secrets when told so', () => {
    const c = loadConfig({ TELEGRAM_BOT_TOKEN: 't', SONIOX_API_KEY: 's' }, { requireWebhookSecrets: false });
    expect(c.telegramWebhookSecret).toBe('');
    expect(c.sonioxWebhookSecret).toBe('');
  });
  it('parses ALLOWED_USER_IDS, keeping the valid ids and listing the invalid entries', () => {
    const c = loadConfig({ ...base, ALLOWED_USER_IDS: ' 12, 34 ,abc,,-5,56 ' });
    expect(c.allowedUserIds).toEqual([12, 34, 56]);
    expect(c.invalidUserIds).toEqual(['abc', '-5']);
    expect(accessMode(c)).toBe('locked');
  });
  it('splits ALLOWED_USER_IDS on spaces as well as commas', () => {
    const c = loadConfig({ ...base, ALLOWED_USER_IDS: '123456789 987654321' });
    expect(c.allowedUserIds).toEqual([123456789, 987654321]);
    expect(c.invalidUserIds).toEqual([]);
    expect(loadConfig({ ...base, ALLOWED_USER_IDS: '1,\t2\n3' }).allowedUserIds).toEqual([1, 2, 3]);
  });
  it('keeps the bot locked, to nobody, when ALLOWED_USER_IDS has no valid id', () => {
    for (const raw of ['@user', '123;456', '0', '99999999999999999999', ',,']) {
      const c = loadConfig({ ...base, ALLOWED_USER_IDS: raw });
      expect(c.allowedUserIds).toEqual([]);
      expect(c.invalidUserIds).toEqual([raw]);
      expect(accessMode(c)).toBe('locked');
      expect(isAllowed(c, 123)).toBe(false);
    }
    // Locked wins over ALLOW_ALL_USERS here too.
    expect(accessMode(loadConfig({ ...base, ALLOWED_USER_IDS: '@user', ALLOW_ALL_USERS: 'true' }))).toBe('locked');
  });
  it('keeps the valid ids of a mixed ALLOWED_USER_IDS', () => {
    const c = loadConfig({ ...base, ALLOWED_USER_IDS: '111, @bob 222;333 444' });
    expect(c.allowedUserIds).toEqual([111, 444]);
    expect(c.invalidUserIds).toEqual(['@bob', '222;333']);
    expect(isAllowed(c, 111)).toBe(true);
    expect(isAllowed(c, 222)).toBe(false);
  });
  it('leaves the bot unlocked when ALLOWED_USER_IDS is empty or blank', () => {
    for (const raw of ['', '   ']) {
      const c = loadConfig({ ...base, ALLOWED_USER_IDS: raw });
      expect(c.allowedUserIds).toEqual([]);
      expect(c.invalidUserIds).toEqual([]);
      expect(accessMode(c)).toBe('open-warn');
    }
  });
  it('treats only "true" as ALLOW_ALL_USERS', () => {
    expect(loadConfig({ ...base, ALLOW_ALL_USERS: 'true' }).allowAllUsers).toBe(true);
    expect(loadConfig({ ...base, ALLOW_ALL_USERS: '1' }).allowAllUsers).toBe(false);
  });
  it('derives publicBaseUrl', () => {
    expect(loadConfig({ ...base, VERCEL_PROJECT_PRODUCTION_URL: 'x.vercel.app' }).publicBaseUrl).toBe('https://x.vercel.app');
    expect(loadConfig({ ...base, PUBLIC_BASE_URL: 'https://bot.example.com/', VERCEL_PROJECT_PRODUCTION_URL: 'x.vercel.app' }).publicBaseUrl).toBe('https://bot.example.com');
  });
  it('marks an explicit PUBLIC_BASE_URL', () => {
    expect(loadConfig(base).publicBaseUrlIsExplicit).toBe(false);
    expect(loadConfig({ ...base, VERCEL_PROJECT_PRODUCTION_URL: 'x.vercel.app' }).publicBaseUrlIsExplicit).toBe(false);
    expect(loadConfig({ ...base, PUBLIC_BASE_URL: 'https://bot.example.com' }).publicBaseUrlIsExplicit).toBe(true);
    expect(loadConfig({ ...base, PUBLIC_BASE_URL: '  ' }).publicBaseUrlIsExplicit).toBe(false);
  });
  it('falls back to he for an unknown BOT_LANGUAGE', () => {
    expect(loadConfig({ ...base, BOT_LANGUAGE: 'fr' }).lang).toBe('he');
    expect(loadConfig({ ...base, BOT_LANGUAGE: 'en' }).lang).toBe('en');
  });
  it('parses LANGUAGE_HINTS, optional keys and models', () => {
    const c = loadConfig({ ...base, LANGUAGE_HINTS: ' ar, ,en ', OPENAI_API_KEY: ' k ', SONIOX_CONTEXT: 'ctx', SONIOX_MODEL: 'm' });
    expect(c.languageHints).toEqual(['ar', 'en']);
    expect(c.openaiApiKey).toBe('k');
    expect(c.sonioxContext).toBe('ctx');
    expect(c.sonioxModel).toBe('m');
    expect(c.openaiModel).toBe(DEFAULT_OPENAI_MODEL);
    expect(loadConfig({ ...base, LANGUAGE_HINTS: ' , ' }).languageHints).toEqual(['he', 'en']);
    expect(loadConfig({ ...base, OPENAI_API_KEY: '', SONIOX_CONTEXT: '' }).openaiApiKey).toBeNull();
  });
});
