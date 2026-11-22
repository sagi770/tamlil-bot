// Pure pieces of `npm run dev`, split out so they can be unit-tested. The loop itself is in scripts/dev.ts.
import type { TgUpdate } from '../../src/telegram-types.js';

/** Dev mode must never register a Soniox webhook, so the public URL variables are dropped. */
export function scrubDevEnv(env: Record<string, string>): Record<string, string> {
  const rest = { ...env };
  delete rest.PUBLIC_BASE_URL;
  delete rest.VERCEL_PROJECT_PRODUCTION_URL;
  return rest;
}

/** The getUpdates offset that acknowledges every update seen so far. */
export function nextOffset(current: number | undefined, updates: readonly TgUpdate[]): number | undefined {
  let max = current === undefined ? undefined : current - 1;
  for (const u of updates) if (max === undefined || u.update_id > max) max = u.update_id;
  return max === undefined ? undefined : max + 1;
}

/** Where the polling loop stands: the next getUpdates offset and how many updates were handled. */
export interface PollState {
  offset: number | undefined;
  processed: number;
}

/**
 * Handles updates one by one and advances state.offset after each, so a handler that throws
 * leaves everything before it acknowledged (it is not redelivered on the next poll).
 */
export async function processUpdates(
  updates: readonly TgUpdate[],
  state: PollState,
  handle: (update: TgUpdate) => Promise<void>,
): Promise<void> {
  for (const update of updates) {
    await handle(update);
    state.offset = nextOffset(state.offset, [update]);
    state.processed++;
  }
}

export const JOB_POLL_INTERVAL_MS = 2000;
export const JOB_POLL_GIVE_UP_MS = 15 * 60 * 1000;

export type JobOutcome = 'completed' | 'error' | 'gave_up' | 'stopped' | 'missing';

/**
 * Polls a job's status until it is completed or error. Returns 'gave_up' after giveUpMs,
 * 'stopped' once the signal aborts and 'missing' as soon as the job no longer exists (null). A failed lookup is reported through onError and retried.
 */
export async function waitForJob(opts: {
  getStatus: () => Promise<string | null>;
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  now: () => number;
  signal: AbortSignal;
  onError: (e: unknown) => void;
  intervalMs?: number;
  giveUpMs?: number;
}): Promise<JobOutcome> {
  const interval = opts.intervalMs ?? JOB_POLL_INTERVAL_MS;
  const deadline = opts.now() + (opts.giveUpMs ?? JOB_POLL_GIVE_UP_MS);
  while (!opts.signal.aborted) {
    try {
      const status = await opts.getStatus();
      if (status === null) return 'missing';
      if (status === 'completed' || status === 'error') return status;
    } catch (e) {
      opts.onError(e);
    }
    if (opts.now() >= deadline) return 'gave_up';
    await opts.sleep(interval, opts.signal);
  }
  return 'stopped';
}
