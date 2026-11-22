// Checks shared by setup and doctor. Each one throws StepFailure with the user's next step.
import { accessMode } from '../../src/access.js';
import { ConfigError, DEFAULT_OPENAI_MODEL, loadConfig } from '../../src/config.js';
import type { Config } from '../../src/config.js';
import { SONIOX_WEBHOOK_PATH, createSonioxGateway } from '../../src/soniox.js';
import { createSummarizer } from '../../src/summarize.js';
import { TelegramApiError } from '../../src/telegram.js';
import { ENV_FILE, parseEnv, readEnvFile } from './env-file.js';
import { probeWebhook } from './probe.js';
import { StepFailure } from './report.js';
import { TelegramNetworkError } from './telegram-admin.js';
import type { TelegramAdmin } from './telegram-admin.js';

export const SECRET_VARS = [
  'TELEGRAM_BOT_TOKEN',
  'SONIOX_API_KEY',
  'OPENAI_API_KEY',
  'TELEGRAM_WEBHOOK_SECRET',
  'SONIOX_WEBHOOK_SECRET',
  // Written into .env.local by `vercel link`; never pushed, hidden in case it ever reaches output.
  'VERCEL_OIDC_TOKEN',
] as const;

const WHERE_TO_GET: Record<string, string> = {
  TELEGRAM_BOT_TOKEN:
    'TELEGRAM_BOT_TOKEN: in Telegram, open @BotFather, send /newbot, and paste the token it gives you into .env.local.',
  SONIOX_API_KEY:
    'SONIOX_API_KEY: create an API key at https://console.soniox.com (add credit there too) and paste it into .env.local.',
  TELEGRAM_WEBHOOK_SECRET: 'TELEGRAM_WEBHOOK_SECRET: run `npm run setup`; it generates this secret.',
  SONIOX_WEBHOOK_SECRET: 'SONIOX_WEBHOOK_SECRET: run `npm run setup`; it generates this secret.',
};

export function readEnvLocal(): Record<string, string> {
  const content = readEnvFile();
  if (content === null) {
    throw new StepFailure(
      `${ENV_FILE} was not found in this folder`,
      'Copy .env.example to .env.local, fill in TELEGRAM_BOT_TOKEN and SONIOX_API_KEY, then run the command again.',
    );
  }
  return parseEnv(content);
}

/** loadConfig, with a "where to get it" line for every missing variable. */
export function requireConfig(env: Record<string, string>, requireWebhookSecrets: boolean): Config {
  try {
    return loadConfig(env, { requireWebhookSecrets });
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    throw new StepFailure(
      `missing ${e.missing.join(', ')} in ${ENV_FILE}`,
      e.missing.map((name) => WHERE_TO_GET[name] ?? name).join('\n'),
    );
  }
}

export async function checkTelegramBot(admin: TelegramAdmin): Promise<{ id: number; username: string }> {
  try {
    return await admin.getMe();
  } catch (e) {
    // 401: revoked token. 404: Telegram's answer to a malformed token.
    if (e instanceof TelegramApiError && (e.code === 401 || e.code === 404)) {
      throw new StepFailure(
        'Telegram rejected the bot token',
        'Copy the token again from @BotFather (/mybots → your bot → API Token) into TELEGRAM_BOT_TOKEN in .env.local.',
      );
    }
    if (e instanceof TelegramNetworkError) {
      throw new StepFailure('Telegram could not be reached', 'check your internet connection, then run again');
    }
    throw e;
  }
}

function httpStatus(e: unknown): number | undefined {
  const code = (e as { statusCode?: unknown } | null)?.statusCode;
  return typeof code === 'number' ? code : undefined;
}

/** Validates the Soniox key by counting what is stored there (also the leftovers doctor reports). */
export async function checkSoniox(config: Config): Promise<{ transcriptions: number; files: number }> {
  try {
    return await createSonioxGateway(config).countLeftovers();
  } catch (e) {
    const status = httpStatus(e);
    if (status === 401 || status === 403) {
      throw new StepFailure(
        `Soniox rejected the API key (HTTP ${status})`,
        'Create or copy a key at https://console.soniox.com into SONIOX_API_KEY in .env.local.',
      );
    }
    throw new StepFailure(
      status ? `Soniox answered HTTP ${status}` : 'Soniox could not be reached',
      'Check your internet connection and run the command again.',
    );
  }
}

const OPENAI_TEST_TEXT = 'שלום, זו בדיקה קצרה של הבוט.';

/** One real summary call: proves the key, the account's credit and the model. False when summaries are off. */
export async function checkOpenAI(config: Config): Promise<boolean> {
  const summarizer = createSummarizer(config);
  if (!summarizer) return false;
  try {
    await summarizer.summarize(OPENAI_TEST_TEXT);
    return true;
  } catch (e) {
    // The message carries only the HTTP status and OpenAI's error code/param, never the key.
    const message = e instanceof Error ? e.message : 'OpenAI request failed';
    throw new StepFailure(message, openAIHint(message, config.openaiModel));
  }
}

function openAIHint(message: string, model: string): string {
  const off = 'Summaries are optional: delete OPENAI_API_KEY from .env.local to turn them off.';
  if (/HTTP 401/.test(message)) {
    return `Check OPENAI_API_KEY in .env.local (keys: https://platform.openai.com/api-keys).\n${off}`;
  }
  if (/insufficient_quota/.test(message)) return `Add credit in your OpenAI account's billing settings.\n${off}`;
  if (/HTTP 404|model_not_found|param=model/.test(message)) {
    return `Your OpenAI account cannot use the model "${model}". Remove OPENAI_MODEL from .env.local to use the default (${DEFAULT_OPENAI_MODEL}), or pick another model.\n${off}`;
  }
  return `Check OPENAI_API_KEY and OPENAI_MODEL in .env.local, then run the command again.\n${off}`;
}

export const TELEGRAM_WEBHOOK_PATH = '/api/telegram';
const RUN_SETUP_AGAIN = 'then run `npm run setup` again.';

/**
 * Probes both endpoints on one host without the secret: Telegram calls the first, Soniox the
 * second (the bot gives Soniox the host Telegram called). Each must be our function, not a
 * Deployment Protection page, and must refuse the request with our 401.
 */
export async function checkEndpoints(base: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const endpoints = [
    { url: `${base}${TELEGRAM_WEBHOOK_PATH}`, caller: 'Telegram' },
    { url: `${base}${SONIOX_WEBHOOK_PATH}`, caller: 'Soniox' },
  ];
  for (const { url, caller } of endpoints) {
    let result: Awaited<ReturnType<typeof probeWebhook>>;
    try {
      result = await probeWebhook(url, fetchImpl);
    } catch {
      throw new StepFailure(`${url} could not be reached`, `Check the deployment in the Vercel dashboard, ${RUN_SETUP_AGAIN}`);
    }
    const { verdict, status } = result;
    if (verdict === 'ours') continue;
    if (verdict === 'protected') {
      throw new StepFailure(
        `${base} is behind Vercel Deployment Protection (HTTP ${status}), and ${caller} cannot call a protected URL`,
        'In the Vercel dashboard open the project → Settings → Deployment Protection and turn it off for production,\n' +
          'or set PUBLIC_BASE_URL in .env.local to a public domain. Then run `npm run setup` again.',
      );
    }
    if (verdict === 'config-error') {
      throw new StepFailure(
        'the bot runs but is missing environment variables (HTTP 500)',
        `Check Settings → Environment Variables in the Vercel dashboard, ${RUN_SETUP_AGAIN}`,
      );
    }
    if (verdict === 'not-found') {
      throw new StepFailure(`${url} does not exist (HTTP 404)`, `Check that the deployment contains the api folder, ${RUN_SETUP_AGAIN}`);
    }
    throw new StepFailure(`unexpected answer from ${url} (HTTP ${status})`, `Check the function logs in the Vercel dashboard (Logs), ${RUN_SETUP_AGAIN}`);
  }
}

/**
 * How to lock the bot once its webhook is live: the webhook consumes /start, so setup cannot read
 * it, but /id answers in every mode except for a user who is locked out.
 */
export function ownerIdHint(botUsername: string | null): string {
  const bot = botUsername ? `@${botUsername}` : 'your bot';
  return `Send /id to ${bot} — it replies with your Telegram ID — then run \`npm run setup -- --owner-id=<ID>\``;
}

export function lockHint(botUsername: string | null): string {
  return [ownerIdHint(botUsername), 'Or add the line ALLOWED_USER_IDS=<ID> to .env.local and run `npm run setup`.'].join('\n');
}

/**
 * A malformed ALLOWED_USER_IDS keeps the bot locked (to its valid ids, or to nobody) but fails
 * setup's Owner step and doctor's Access step. The entries are not secrets, so they are named.
 */
export function checkAllowedUserIds(config: Config): void {
  const bad = config.invalidUserIds;
  if (bad.length === 0) return;
  const ids = config.allowedUserIds;
  const effect = ids.length > 0 ? `the bot stays locked to ${ids.join(', ')} only` : 'the bot stays locked and nobody can use it';
  throw new StepFailure(
    `ALLOWED_USER_IDS has entries that are not Telegram IDs: ${bad.join(', ')}; ${effect}`,
    'Write numeric Telegram IDs separated by commas, for example ALLOWED_USER_IDS=123456789,987654321 (each person gets theirs with /id).\n' +
      'Fix the line in .env.local, then run `npm run setup`.',
  );
}

/** The access mode in words, without the how-to-lock hint. */
export function accessLine(config: Config): string {
  const mode = accessMode(config);
  if (mode === 'locked') {
    const ids = config.allowedUserIds;
    const bad = config.invalidUserIds.join(', ');
    const ignored = config.allowAllUsers ? ' (ALLOW_ALL_USERS=true is ignored while ALLOWED_USER_IDS is set)' : '';
    if (ids.length === 0) return `locked to nobody (ALLOWED_USER_IDS has no valid Telegram ID: ${bad})${ignored}`;
    const who = ids.length === 1 ? 'one Telegram user' : `${ids.length} Telegram users`;
    const skipped = bad ? ` (ignored, not Telegram IDs: ${bad})` : '';
    return `locked to ${who}: ${ids.join(', ')}${skipped}${ignored}`;
  }
  if (mode === 'open') return 'public on purpose (ALLOW_ALL_USERS=true): anyone can use it, on your accounts';
  return 'OPEN TO EVERYONE, with a warning after /start and after every transcript';
}

/** The access mode in words, for the final summary; an open bot also gets how to lock it. */
export function accessWords(config: Config, botUsername: string | null): string {
  const line = accessLine(config);
  return accessMode(config) === 'open-warn' ? `${line}. To lock it: ${ownerIdHint(botUsername)}` : line;
}
