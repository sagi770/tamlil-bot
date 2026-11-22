// npm run doctor: a read-only health check. It never writes .env.local, never runs a Vercel
// command that changes anything, calls only Telegram methods that read, and probes the bot's own
// endpoints only with requests they refuse (no secret).
import { accessMode } from '../src/access.js';
import type { Config } from '../src/config.js';
import {
  SECRET_VARS,
  TELEGRAM_WEBHOOK_PATH,
  accessWords,
  checkAllowedUserIds,
  checkEndpoints,
  checkOpenAI,
  checkSoniox,
  checkTelegramBot,
  lockHint,
  readEnvLocal,
  requireConfig,
} from './lib/checks.js';
import { StepFailure, crash, finish, heading, hideSecrets, setDefaultHint, step } from './lib/report.js';
import { createTelegramAdmin } from './lib/telegram-admin.js';
import { readLink } from './lib/vercel-cli.js';

let config: Config | null = null;
let botUsername: string | null = null;

function summaryLines(): string[] {
  const lines: string[] = [];
  if (botUsername) lines.push(`Your bot: https://t.me/${botUsername}`);
  if (config) lines.push(`Access:   ${accessWords(config, botUsername)}`);
  return lines;
}

const stop = (): never => finish(summaryLines());

async function main(): Promise<void> {
  // doctor is what the other scripts' default hint points to, so its own default points to the docs.
  setDefaultHint('Run the command again. If it keeps failing, see the Troubleshooting section of the README.');
  heading('tamlil-bot doctor (read-only)');

  const env = await step('Read .env.local', () => {
    const read = readEnvLocal();
    hideSecrets(SECRET_VARS.map((name) => read[name]));
    return read;
  });
  if (!env) return stop();

  await step('Required variables', (ctx) => {
    requireConfig(env, true);
    ctx.detail('TELEGRAM_BOT_TOKEN, SONIOX_API_KEY and both webhook secrets are set');
  });
  // The checks below need the token and the Soniox key; a missing webhook secret is reported above.
  try {
    config = requireConfig(env, false);
  } catch {
    return stop();
  }
  const c = config;

  const admin = createTelegramAdmin(c.telegramToken);
  const bot = await step('Telegram bot token', async (ctx) => {
    const me = await checkTelegramBot(admin);
    ctx.detail(`@${me.username}`);
    return me;
  });
  botUsername = bot?.username ?? null;

  const stored = await step('Soniox API key', async (ctx) => {
    const counts = await checkSoniox(c);
    ctx.detail('accepted');
    return counts;
  });

  await step('OpenAI summaries', async (ctx) => {
    const on = await checkOpenAI(c);
    ctx.detail(on ? `key and model ${c.openaiModel} work` : 'off (OPENAI_API_KEY is not set)');
  });

  // The base the webhook is registered on (setup's production URL), when it points at this bot.
  let webhookBase: string | undefined;
  if (bot) {
    webhookBase = await step('Telegram webhook', async (ctx) => {
      const info = await admin.getWebhookInfo();
      if (!info.url) {
        throw new StepFailure('no webhook is registered, so Telegram does not deliver messages to the bot', 'Run `npm run setup`.');
      }
      if (!info.url.endsWith(TELEGRAM_WEBHOOK_PATH)) {
        throw new StepFailure(`the webhook points to ${info.url}`, 'Run `npm run setup` to point it at this bot.');
      }
      if (info.last_error_message) {
        const when = info.last_error_date ? ` at ${new Date(info.last_error_date * 1000).toISOString()}` : '';
        ctx.warn(
          `Telegram's last delivery error${when}: "${info.last_error_message}" (${info.pending_update_count} update(s) waiting)`,
          'If the error is recent, check the function logs in the Vercel dashboard (Logs) and run `npm run setup` again.\nAn old error that no longer repeats can be ignored.',
        );
      }
      ctx.detail(`${info.url} (${info.pending_update_count} update(s) waiting)`);
      return info.url.slice(0, -TELEGRAM_WEBHOOK_PATH.length);
    });
  }

  if (webhookBase) {
    const base = webhookBase;
    // Read-only: POSTs without the secret, which both endpoints must refuse with our 401.
    await step('Webhook endpoint check', async (ctx) => {
      await checkEndpoints(base);
      ctx.detail('both endpoints answer, and refuse requests without the secret (401)');
    });
  }

  await step('Vercel project link', (ctx) => {
    const linked = readLink();
    if (!linked) {
      throw new StepFailure('this folder is not linked to a Vercel project (.vercel/project.json is missing)', 'Run `npm run setup`; it links and deploys the project.');
    }
    ctx.detail(linked.projectName ? `linked to ${linked.projectName}` : 'linked');
  });

  await step('Access mode', (ctx) => {
    checkAllowedUserIds(c);
    if (c.allowedUserIds.length > 0 && c.allowAllUsers) {
      throw new StepFailure(
        'ALLOWED_USER_IDS and ALLOW_ALL_USERS=true are both set; the lock wins, so the bot is not public',
        'Keep one: delete ALLOW_ALL_USERS for a private bot, or empty ALLOWED_USER_IDS for a public one.\nThen run `npm run setup` so Vercel gets the change.',
      );
    }
    if (accessMode(c) === 'open-warn') {
      throw new StepFailure('the bot is open to everyone: anyone who finds it can transcribe on your accounts', lockHint(botUsername));
    }
    ctx.detail(accessWords(c, botUsername));
  });

  if (stored) {
    await step('Recordings stored at Soniox', (ctx) => {
      const { transcriptions, files } = stored;
      if (transcriptions + files === 0) {
        ctx.detail('none');
        return;
      }
      ctx.warn(
        `${transcriptions} transcription(s) and ${files} file(s)`,
        'If nothing is being transcribed right now, these were left behind by failed deliveries; Soniox deletes them after 30 days.',
      );
    });
  }

  stop();
}

main().catch((e: unknown) => crash(e, summaryLines));
