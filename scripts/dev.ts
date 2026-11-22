// npm run dev: runs the bot on this machine with Telegram long polling, reusing the production
// handlers. Soniox completion is found by polling the job instead of a webhook. Nothing is
// deployed or registered, so no tunnel is needed.
import { accessMode } from '../src/access.js';
import { ConfigError } from '../src/config.js';
import { buildDeps } from '../src/deps.js';
import type { Deps } from '../src/deliver.js';
import { handleSonioxEvent } from '../src/handle-soniox.js';
import { handleUpdate } from '../src/handle-update.js';
import { ENV_FILE, parseEnv, readEnvFile } from './lib/env-file.js';
import { accessLine, ownerIdHint } from './lib/checks.js';
import { processUpdates, scrubDevEnv, waitForJob } from './lib/dev-logic.js';
import type { PollState } from './lib/dev-logic.js';
import { createTelegramAdmin } from './lib/telegram-admin.js';

const POLL_TIMEOUT_SEC = 25;
const RETRY_DELAY_MS = 5000;
const ACK_TIMEOUT_MS = 5000;
const RECONNECT_HINT = 'The deployed bot is disconnected: run `npm run setup` to reconnect it.';

const errorName = (e: unknown): string => (e instanceof Error ? e.constructor.name : typeof e);

/** Resolves after ms, or as soon as the signal aborts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    }
    signal.addEventListener('abort', done, { once: true });
  });
}

function loadDeps(): Deps | null {
  const content = readEnvFile();
  if (content === null) {
    console.log(`${ENV_FILE} was not found in this folder.`);
    console.log('Copy .env.example to .env.local, fill in TELEGRAM_BOT_TOKEN and SONIOX_API_KEY, then run `npm run dev` again.');
    return null;
  }
  try {
    return buildDeps(scrubDevEnv(parseEnv(content)), { requireWebhookSecrets: false });
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    console.log(`Missing in ${ENV_FILE}: ${e.missing.join(', ')}`);
    console.log('See .env.example for where to get each value, then run `npm run dev` again.');
    return null;
  }
}

async function main(): Promise<void> {
  const takeover = process.argv.includes('--takeover');
  const deps = loadDeps();
  if (!deps) {
    process.exitCode = 1;
    return;
  }
  const admin = createTelegramAdmin(deps.config.telegramToken);

  const stop = new AbortController();
  process.once('SIGINT', () => {
    console.log('\nStopping...');
    stop.abort();
  });

  let me: { id: number; username: string };
  let webhookUrl: string;
  try {
    me = await admin.getMe(stop.signal);
    webhookUrl = (await admin.getWebhookInfo(stop.signal)).url;
  } catch (e) {
    if (stop.signal.aborted) return;
    console.log(`Could not reach Telegram: ${e instanceof Error ? e.message : errorName(e)}`);
    console.log('Check TELEGRAM_BOT_TOKEN in .env.local and your internet connection.');
    process.exitCode = 1;
    return;
  }

  if (webhookUrl !== '' && !takeover) {
    console.log(`@${me.username} is connected to a deployed bot (it has a webhook set).`);
    console.log('Running dev mode on this token would disconnect the deployed bot until you run `npm run setup` again.');
    console.log('Recommended: create a separate bot with @BotFather and put its token in .env.local for development.');
    console.log('To use this token anyway, run `npm run dev -- --takeover`.');
    process.exitCode = 1;
    return;
  }

  let webhookDeleted = false;
  if (webhookUrl !== '') {
    try {
      await admin.deleteWebhook();
      webhookDeleted = true;
    } catch (e) {
      console.log(`Could not remove the webhook: ${e instanceof Error ? e.message : errorName(e)}`);
      process.exitCode = 1;
      return;
    }
  }

  try {
    await runLoop(deps, admin, me.username, stop);
  } finally {
    // Shown whenever --takeover removed the webhook, however the run ended.
    if (webhookDeleted) console.log(RECONNECT_HINT);
  }
}

async function runLoop(
  deps: Deps,
  admin: ReturnType<typeof createTelegramAdmin>,
  username: string,
  stop: AbortController,
): Promise<void> {
  const watchers = new Set<Promise<void>>();
  deps.afterStart = (jobId) => {
    const watcher = watchJob(deps, jobId, stop.signal).finally(() => watchers.delete(watcher));
    watchers.add(watcher);
  };

  console.log(`@${username}: dev mode — long polling. Access: ${accessLine(deps.config)}`);
  if (accessMode(deps.config) === 'open-warn') console.log(`To lock it: ${ownerIdHint(username)}`);
  console.log('Press Ctrl+C to stop.');

  const state: PollState = { offset: undefined, processed: 0 };
  while (!stop.signal.aborted) {
    try {
      const updates = await admin.getUpdates({ offset: state.offset, timeoutSec: POLL_TIMEOUT_SEC, signal: stop.signal });
      await processUpdates(updates, state, (update) => handleUpdate(deps, update));
    } catch (e) {
      if (stop.signal.aborted) break;
      deps.log.error('dev_poll_failed', { error: errorName(e) });
      await sleep(RETRY_DELAY_MS, stop.signal);
    }
  }

  // The last offset is only acknowledged by the next getUpdates call. Without one, Telegram would
  // deliver the last handled updates again on the next run. Best effort: a failure changes nothing.
  if (state.processed > 0) {
    try {
      await admin.getUpdates({ offset: state.offset, timeoutSec: 0, signal: AbortSignal.timeout(ACK_TIMEOUT_MS) });
    } catch {
      // ignored on purpose
    }
  }

  await Promise.allSettled([...watchers]);
}

/** Background: waits for a Soniox job to finish, then delivers it exactly as the webhook would. */
async function watchJob(deps: Deps, jobId: string, signal: AbortSignal): Promise<void> {
  try {
    const outcome = await waitForJob({
      getStatus: async () => (await deps.soniox.getJob(jobId))?.status ?? null,
      sleep,
      now: Date.now,
      signal,
      onError: (e) => deps.log.error('dev_job_poll_failed', { error: errorName(e) }),
    });
    if (outcome === 'gave_up') {
      deps.log.error('dev_job_gave_up', { jobId });
      return;
    }
    if (outcome === 'stopped') return;
    if (outcome === 'missing') {
      deps.log.info('dev_job_missing', { jobId });
      return;
    }
    const result = await handleSonioxEvent(deps, { id: jobId, status: outcome });
    if (result.background) await result.background;
  } catch (e) {
    deps.log.error('dev_job_failed', { error: errorName(e) });
  }
}

main().catch((e: unknown) => {
  console.log(`Unexpected error: ${e instanceof Error ? e.message : errorName(e)}`);
  process.exitCode = 1;
});
