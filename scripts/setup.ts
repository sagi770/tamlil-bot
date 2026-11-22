// npm run setup: validates the keys, generates the webhook secrets, finds the owner's Telegram id,
// pushes the variables to Vercel, deploys, registers the webhook and runs a smoke test.
// Non-interactive and safe to run again. Never prints a secret.
import { randomBytes } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig } from '../src/config.js';
import type { Config } from '../src/config.js';
import { SonioxStartError, createSonioxGateway } from '../src/soniox.js';
import { getStrings } from '../src/strings/index.js';
import { createTelegramClient } from '../src/telegram.js';
import {
  SECRET_VARS,
  TELEGRAM_WEBHOOK_PATH,
  accessWords,
  checkAllowedUserIds,
  checkEndpoints,
  checkOpenAI,
  checkSoniox,
  checkTelegramBot,
  ownerIdHint,
  readEnvLocal,
  requireConfig,
} from './lib/checks.js';
import { ENV_FILE, parseEnv, readEnvFile, restoreFilesAfter, upsertEnv, writeEnvFile } from './lib/env-file.js';
import { findOwner, parseOwnerId } from './lib/owner.js';
import { StepFailure, crash, finish, hasFailures, heading, hideSecrets, info, step } from './lib/report.js';
import { createTelegramAdmin } from './lib/telegram-admin.js';
import type { TelegramAdmin } from './lib/telegram-admin.js';
import * as vercel from './lib/vercel-cli.js';

// Same names and order as the variables table in the README and .env.example. Non-empty ones are pushed to Vercel; empty or absent ones are removed there.
const SPEC_VARS = [
  'TELEGRAM_BOT_TOKEN',
  'SONIOX_API_KEY',
  'TELEGRAM_WEBHOOK_SECRET',
  'SONIOX_WEBHOOK_SECRET',
  'ALLOWED_USER_IDS',
  'ALLOW_ALL_USERS',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'BOT_LANGUAGE',
  'BOT_TIMEZONE',
  'LANGUAGE_HINTS',
  'SONIOX_MODEL',
  'SONIOX_CONTEXT',
  'PUBLIC_BASE_URL',
];
const GENERATED_SECRETS = ['TELEGRAM_WEBHOOK_SECRET', 'SONIOX_WEBHOOK_SECRET'];
const SAMPLE_AUDIO = 'https://soniox.com/media/examples/coffee_shop.mp3';
const SMOKE_POLL_MS = 3_000;
const SMOKE_TIMEOUT_MS = 180_000;
const GITIGNORE_FILE = '.gitignore';
const AGAIN = 'then run `npm run setup` again.';

let env: Record<string, string> = {};
let botUsername: string | null = null;

function saveEnv(key: string, value: string): void {
  writeEnvFile(upsertEnv(readEnvFile() ?? '', key, value));
  env = parseEnv(readEnvFile() ?? '');
}

function summaryLines(): string[] {
  const lines: string[] = [];
  if (botUsername) lines.push(`Your bot: https://t.me/${botUsername}`);
  try {
    lines.push(`Access:   ${accessWords(loadConfig(env, { requireWebhookSecrets: false }), botUsername)}`);
  } catch {
    // Required keys are missing; the failed first step already says so.
  }
  return lines;
}

const stop = (): never => finish(summaryLines());

/** --owner-id=<id>: a number, null when absent, or 'invalid' (never saved). */
function ownerFlag(): number | null | 'invalid' {
  const arg = process.argv.slice(2).find((a) => a.startsWith('--owner-id'));
  if (arg === undefined) return null;
  const id = arg.startsWith('--owner-id=') ? parseOwnerId(arg.slice('--owner-id='.length)) : null;
  return id ?? 'invalid';
}

async function detectOwner(config: Config, admin: TelegramAdmin, bot: string): Promise<number | null> {
  return (
    (await step('Owner (who may use the bot)', async (ctx) => {
      // A malformed list fails here and is never replaced by a detected owner.
      checkAllowedUserIds(config);
      const flag = ownerFlag();
      if (config.allowedUserIds.length > 0) {
        ctx.detail(`already locked to ${config.allowedUserIds.join(', ')} (ALLOWED_USER_IDS)`);
        if (typeof flag === 'number' && !config.allowedUserIds.includes(flag)) {
          ctx.warn(
            `--owner-id was ignored because ALLOWED_USER_IDS is already set to ${config.allowedUserIds.join(', ')}`,
            `To change who may use the bot, edit ALLOWED_USER_IDS in .env.local, ${AGAIN}`,
          );
        }
        return config.allowedUserIds[0];
      }
      if (config.allowAllUsers) {
        ctx.detail('skipped, ALLOW_ALL_USERS=true makes the bot public on purpose');
        return null;
      }
      if (flag === 'invalid') {
        throw new StepFailure(
          '--owner-id must be your numeric Telegram id: 1 to 15 digits, not starting with 0',
          'Example: npm run setup -- --owner-id=123456789',
        );
      }

      let owner: { id: number; username: string | null } | null = flag === null ? null : { id: flag, username: null };
      let webhookLive = false;
      if (!owner) {
        // First run: no webhook yet, so the /start the user sent before setup is still queued.
        // A live webhook has already consumed it (and getUpdates refuses to run), so detection is skipped.
        webhookLive = (await admin.getWebhookInfo()).url !== '';
        if (!webhookLive) owner = findOwner(await admin.getUpdates());
      }
      if (!owner) {
        ctx.warn(
          webhookLive
            ? 'the bot is already live, so setup cannot read your /start; it stays open to everyone'
            : 'no /start message found, so the bot stays open to everyone',
          ownerIdHint(bot),
        );
        return null;
      }
      saveEnv('ALLOWED_USER_IDS', String(owner.id));
      const who = owner.username ? `@${owner.username} (Telegram id ${owner.id})` : `Telegram id ${owner.id}`;
      ctx.detail(`locked to ${who}${flag === null ? '' : ' from --owner-id'}, saved as ALLOWED_USER_IDS`);
      return owner.id;
    })) ?? null
  );
}

async function smokeTest(config: Config): Promise<void> {
  await step('Soniox test transcription', async (ctx) => {
    // No webhook: this job is polled here, never delivered to the bot.
    const gateway = createSonioxGateway({ ...config, publicBaseUrl: null });
    let id: string;
    try {
      ({ id } = await gateway.startFromUrl({ url: SAMPLE_AUDIO, ref: 'setup-smoke' }));
    } catch (e) {
      if (e instanceof SonioxStartError && e.kind === 'payment') {
        throw new StepFailure(
          'Soniox needs credit on your account',
          `Add credit in the Soniox console (https://console.soniox.com), ${AGAIN}`,
        );
      }
      throw e;
    }
    try {
      const deadline = Date.now() + SMOKE_TIMEOUT_MS;
      for (;;) {
        const job = await gateway.getJob(id);
        if (job?.status === 'completed') {
          const secs = job.durationMs === null ? null : Math.round(job.durationMs / 1000);
          ctx.detail(secs === null ? 'the sample file was transcribed' : `transcribed the ${secs}-second sample file`);
          return;
        }
        if (!job) throw new StepFailure('the test job disappeared at Soniox', `Wait a minute, ${AGAIN}`);
        if (job.status === 'error') {
          throw new StepFailure(
            'Soniox could not transcribe its own sample file',
            `Check your account at https://console.soniox.com, ${AGAIN}`,
          );
        }
        if (Date.now() >= deadline) {
          throw new StepFailure('the test transcription did not finish within 3 minutes', `Soniox may be busy; wait a little, ${AGAIN}`);
        }
        await sleep(SMOKE_POLL_MS);
      }
    } finally {
      await gateway.destroy(id).catch(() => undefined);
    }
  });
}

async function main(): Promise<void> {
  heading('tamlil-bot setup');

  // 1. Local configuration.
  const initial = await step('Read .env.local', () => {
    env = readEnvLocal();
    hideSecrets(SECRET_VARS.map((name) => env[name]));
    return requireConfig(env, false);
  });
  if (!initial) return stop();

  // 2. Keys. All three are checked before stopping, so every bad key shows up in one run.
  const admin = createTelegramAdmin(initial.telegramToken);
  const bot = await step('Telegram bot token', async (ctx) => {
    const me = await checkTelegramBot(admin);
    ctx.detail(`@${me.username}`);
    return me;
  });
  botUsername = bot?.username ?? null;
  await step('Soniox API key', async (ctx) => {
    await checkSoniox(initial);
    ctx.detail('accepted');
  });
  await step('OpenAI summaries', async (ctx) => {
    const on = await checkOpenAI(initial);
    ctx.detail(on ? `key and model ${initial.openaiModel} work` : 'off (OPENAI_API_KEY is not set)');
  });
  if (!bot) return stop();

  // 3. Webhook secrets.
  const secretsReady = await step('Webhook secrets', (ctx) => {
    const created = GENERATED_SECRETS.filter((name) => !env[name]?.trim());
    for (const name of created) {
      const value = randomBytes(32).toString('hex');
      hideSecrets([value]);
      saveEnv(name, value);
    }
    ctx.detail(created.length > 0 ? `generated ${created.join(' and ')} in .env.local` : 'already in .env.local');
    return true;
  });
  if (!secretsReady) return stop();

  // 4. Owner.
  const ownerId = await detectOwner(loadConfig(env), admin, bot.username);
  const config = loadConfig(env);

  // 5. Vercel CLI and login.
  const cliReady = await step('Vercel CLI', (ctx) => {
    const v = vercel.version();
    if (!v) throw new StepFailure('the Vercel CLI is not installed', vercel.INSTALL_HINT);
    if (!vercel.isAtLeast(v, vercel.MIN_CLI_VERSION)) {
      throw new StepFailure(`version ${v} is too old (setup needs ${vercel.MIN_CLI_VERSION} or later)`, vercel.INSTALL_HINT);
    }
    ctx.detail(`version ${v}`);
    return true;
  });
  if (cliReady) {
    await step('Vercel login', (ctx) => {
      const user = vercel.whoami();
      if (!user) throw new StepFailure('not logged in', `Run \`vercel login\`, ${AGAIN}`);
      ctx.detail(`logged in as ${user}`);
    });
  }
  // Nothing is deployed while a key or prerequisite above is broken.
  if (hasFailures()) return stop();

  // 6. Link, variables, deploy.
  const linked = await step(
    'Vercel project',
    (ctx) => {
      const existing = vercel.readLink();
      if (existing) {
        ctx.detail(`already linked${existing.projectName ? ` to ${existing.projectName}` : ''}`);
        return true;
      }
      // Older CLIs could overwrite .env.local while linking, and current ones add VERCEL_OIDC_TOKEN;
      // linking also appends `.env*` to .gitignore, which would hide .env.example. Put both files back
      // exactly as they were, whether link worked or not.
      restoreFilesAfter([ENV_FILE, GITIGNORE_FILE], () => vercel.link());
      ctx.detail(`linked to ${vercel.PROJECT_NAME}`);
      return true;
    },
    'If the lines above mention choosing a team or scope, run `vercel teams ls`, pick the team,\n' +
      'run `vercel switch <team-slug>`, then run `npm run setup` again.\n' +
      'Otherwise see the Troubleshooting section of the README.',
  );
  if (!linked) return stop();

  const pushed = await step(
    'Environment variables on Vercel',
    (ctx) => {
      const hasValue = (name: string) => (env[name] ?? '').trim() !== '';
      const names = SPEC_VARS.filter(hasValue);
      for (const name of names) vercel.setEnv(name, env[name].trim());
      // A variable emptied or deleted in .env.local must stop applying in production too
      // (e.g. no OPENAI_API_KEY means no summaries). One with a local value is never removed.
      const removed: string[] = [];
      for (const name of SPEC_VARS) {
        if (!hasValue(name) && vercel.removeEnv(name)) removed.push(name);
      }
      ctx.detail(
        `${names.length} saved for production: ${names.join(', ')}` +
          (removed.length > 0 ? `; removed from production: ${removed.join(', ')}` : ''),
      );
      return true;
    },
    `Check the project in the Vercel dashboard (Settings → Environment Variables), ${AGAIN}`,
  );
  if (!pushed) return stop();

  info('Deploying to production. This usually takes one to three minutes…');
  const deploymentUrl = await step(
    'Deploy to production',
    (ctx) => {
      const url = vercel.deployProd();
      ctx.detail(url);
      return url;
    },
    `Fix the error shown above (build logs: Vercel dashboard → Deployments), ${AGAIN}`,
  );
  if (!deploymentUrl) return stop();

  const base = await step(
    'Production URL',
    (ctx) => {
      const explicit = env.PUBLIC_BASE_URL?.trim().replace(/\/+$/, '');
      if (explicit) {
        if (!explicit.startsWith('https://')) {
          throw new StepFailure('PUBLIC_BASE_URL must start with https://', `Fix PUBLIC_BASE_URL in .env.local, ${AGAIN}`);
        }
        ctx.detail(`${explicit} (from PUBLIC_BASE_URL)`);
        return explicit;
      }
      const url = vercel.productionUrl(deploymentUrl);
      ctx.detail(url);
      return url;
    },
    `Set PUBLIC_BASE_URL in .env.local to the production address (Vercel dashboard → your project → Domains), ${AGAIN}`,
  );
  if (!base) return stop();
  const webhookUrl = `${base}${TELEGRAM_WEBHOOK_PATH}`;

  // 7. Telegram webhook and command menu.
  await step(
    'Telegram webhook',
    async (ctx) => {
      await admin.setWebhook({ url: webhookUrl, secret: config.telegramWebhookSecret });
      ctx.detail(webhookUrl);
    },
    `Check that ${base} is a public https address, ${AGAIN}`,
  );
  await step('Telegram command menu', async (ctx) => {
    const { commands } = getStrings(config.lang);
    await admin.setMyCommands([
      { command: 'start', description: commands.start },
      { command: 'help', description: commands.help },
      { command: 'id', description: commands.id },
    ]);
    ctx.detail('/start, /help, /id');
  });

  // 8. Both endpoints on this host (Telegram's, and Soniox's, which gets the host Telegram calls)
  // must be our functions and must refuse requests without the secret.
  await step('Webhook endpoint check', async (ctx) => {
    await checkEndpoints(base);
    ctx.detail('both endpoints answer, and refuse requests without the secret (401)');
  });

  // 9. Smoke test: proves the Soniox key and credit end to end.
  info('Transcribing a short Soniox sample file (up to 3 minutes)…');
  await smokeTest(config);

  // 10. Tell the owner, but only when everything above worked.
  if (ownerId !== null && !hasFailures()) {
    await step('Ready message', async (ctx) => {
      try {
        await createTelegramClient(config.telegramToken).sendMessage(ownerId, getStrings(config.lang).botReady);
        ctx.detail(`sent to Telegram id ${ownerId}`);
      } catch (e) {
        ctx.warn(
          `could not message Telegram id ${ownerId} (${e instanceof Error ? e.message : 'unknown error'})`,
          `Send /start to @${bot.username} in Telegram; the bot is ready anyway.`,
        );
      }
    });
  }

  // 11. Summary.
  stop();
}

main().catch((e: unknown) => crash(e, summaryLines));
