import type { Lang } from './types.js';

export const DEFAULT_OPENAI_MODEL = 'gpt-6-luna';

export interface Config {
  telegramToken: string;
  telegramWebhookSecret: string;
  sonioxApiKey: string;
  sonioxWebhookSecret: string;
  sonioxModel: string;
  languageHints: string[];
  sonioxContext: string | null;
  allowedUserIds: number[];
  /** ALLOWED_USER_IDS entries that are not Telegram ids. Not secret; setup and doctor name them. */
  invalidUserIds: string[];
  allowAllUsers: boolean;
  openaiApiKey: string | null;
  openaiModel: string;
  lang: Lang;
  timeZone: string;
  /** PUBLIC_BASE_URL, else https://VERCEL_PROJECT_PRODUCTION_URL. */
  publicBaseUrl: string | null;
  /** True when publicBaseUrl came from PUBLIC_BASE_URL: it then wins over the host Telegram called. */
  publicBaseUrlIsExplicit: boolean;
}

export class ConfigError extends Error {
  readonly missing: string[];
  constructor(missing: string[]) {
    super(`Missing required environment variables: ${missing.join(', ')}`);
    this.name = 'ConfigError';
    this.missing = missing;
  }
}

type Env = Record<string, string | undefined>;

function val(env: Env, name: string): string | null {
  const v = env[name]?.trim();
  return v ? v : null;
}

function parseHints(raw: string | null): string[] {
  const hints = (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return hints.length > 0 ? hints : ['he', 'en'];
}

/**
 * Splits on commas and whitespace. Valid ids are positive safe integers written as digits; every
 * other entry is invalid. A value made only of separators is itself one invalid entry, so a
 * non-empty ALLOWED_USER_IDS always locks the bot (see access.ts), possibly to nobody.
 */
function parseUserIds(raw: string | null): { valid: number[]; invalid: string[] } {
  if (raw === null) return { valid: [], invalid: [] };
  const entries = raw.split(/[\s,]+/).filter(Boolean);
  if (entries.length === 0) return { valid: [], invalid: [raw] };
  const valid: number[] = [];
  const invalid: string[] = [];
  for (const entry of entries) {
    const id = /^\d+$/.test(entry) ? Number(entry) : Number.NaN;
    if (Number.isSafeInteger(id) && id > 0) valid.push(id);
    else invalid.push(entry);
  }
  return { valid, invalid };
}

function derivePublicBaseUrl(env: Env): string | null {
  const explicit = val(env, 'PUBLIC_BASE_URL');
  if (explicit) return explicit.replace(/\/+$/, '');
  const vercel = val(env, 'VERCEL_PROJECT_PRODUCTION_URL');
  return vercel ? `https://${vercel}` : null;
}

function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function parseTimeZone(raw: string | null, lang: Lang): string {
  const fallback = lang === 'he' ? 'Asia/Jerusalem' : 'UTC';
  return raw !== null && isValidTimeZone(raw) ? raw : fallback;
}

export function loadConfig(env: Env, opts: { requireWebhookSecrets?: boolean } = {}): Config {
  const requireSecrets = opts.requireWebhookSecrets !== false;
  const required = ['TELEGRAM_BOT_TOKEN', 'SONIOX_API_KEY'];
  if (requireSecrets) required.push('TELEGRAM_WEBHOOK_SECRET', 'SONIOX_WEBHOOK_SECRET');
  const lang: Lang = val(env, 'BOT_LANGUAGE') === 'en' ? 'en' : 'he';
  const missing = required.filter((name) => val(env, name) === null);
  if (missing.length > 0) throw new ConfigError(missing);
  const userIds = parseUserIds(val(env, 'ALLOWED_USER_IDS'));

  return {
    telegramToken: val(env, 'TELEGRAM_BOT_TOKEN') ?? '',
    telegramWebhookSecret: val(env, 'TELEGRAM_WEBHOOK_SECRET') ?? '',
    sonioxApiKey: val(env, 'SONIOX_API_KEY') ?? '',
    sonioxWebhookSecret: val(env, 'SONIOX_WEBHOOK_SECRET') ?? '',
    sonioxModel: val(env, 'SONIOX_MODEL') ?? 'stt-async-v5',
    languageHints: parseHints(val(env, 'LANGUAGE_HINTS')),
    sonioxContext: val(env, 'SONIOX_CONTEXT'),
    allowedUserIds: userIds.valid,
    invalidUserIds: userIds.invalid,
    allowAllUsers: val(env, 'ALLOW_ALL_USERS') === 'true',
    openaiApiKey: val(env, 'OPENAI_API_KEY'),
    openaiModel: val(env, 'OPENAI_MODEL') ?? DEFAULT_OPENAI_MODEL,
    lang,
    timeZone: parseTimeZone(val(env, 'BOT_TIMEZONE'), lang),
    publicBaseUrl: derivePublicBaseUrl(env),
    publicBaseUrlIsExplicit: val(env, 'PUBLIC_BASE_URL') !== null,
  };
}
