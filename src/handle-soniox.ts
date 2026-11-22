import { deliverSummary, deliverTranscript, sendOpenWarningIfNeeded } from './deliver.js';
import type { Deps } from './deliver.js';
import { decodeRef } from './reference.js';
import type { JobRef } from './reference.js';
import { groupTokensIntoSegments } from './segments.js';
import type { SonioxJob } from './soniox.js';

export interface SonioxEventResult {
  status: 200 | 500;
  background: Promise<void> | null;
}

const OK: SonioxEventResult = { status: 200, background: null };
const FAILED: SonioxEventResult = { status: 500, background: null };

function errorName(e: unknown): string {
  return e instanceof Error ? e.constructor.name : typeof e;
}

/** Runs a best-effort step: a failure is logged by class name and swallowed. */
async function bestEffort(deps: Deps, event: string, step: () => Promise<unknown>): Promise<void> {
  try {
    await step();
  } catch (e) {
    deps.log.error(event, { error: errorName(e) });
  }
}

const deleteStatus = (deps: Deps, ref: JobRef) =>
  bestEffort(deps, 'status_delete_failed', () => deps.tg.deleteMessage(ref.chatId, ref.statusMessageId));
const destroyJob = (deps: Deps, id: string) => bestEffort(deps, 'destroy_failed', () => deps.soniox.destroy(id));

interface FollowUp {
  /** Only after a transcript or noSpeech, never after an error text. */
  openWarning: boolean;
  /** The delivered transcript, when mode s and a summarizer exist. */
  summarize: { transcriptText: string; messageId: number } | null;
}

/**
 * Everything after the user-facing result, as one task: delete status, destroy, open warning,
 * summary. Every step is best effort, so the promise never rejects.
 */
async function followUp(deps: Deps, job: SonioxJob, ref: JobRef, next: FollowUp): Promise<void> {
  await deleteStatus(deps, ref);
  await destroyJob(deps, job.id);
  if (next.openWarning) {
    await bestEffort(deps, 'open_warning_failed', () => sendOpenWarningIfNeeded(deps, ref.chatId, ref.chatId));
  }
  const source = next.summarize;
  if (source === null) return;
  let summarized = false;
  await bestEffort(deps, 'summary_background_failed', async () => {
    summarized = await deliverSummary(deps, { chatId: ref.chatId, replyTo: source.messageId, transcript: source.transcriptText });
  });
  // The summary is out, so the button would only produce a duplicate. A failed summary keeps it for a retry.
  if (summarized) {
    await bestEffort(deps, 'remove_keyboard_failed', () => deps.tg.removeKeyboard(ref.chatId, source.messageId));
  }
}

/**
 * The user has their result: answer 200 now and hand the follow-up to the background. A fast
 * answer shrinks the window in which Soniox times out and retries.
 */
function answered(deps: Deps, job: SonioxJob, ref: JobRef, next: FollowUp): SonioxEventResult {
  return { status: 200, background: followUp(deps, job, ref, next) };
}

async function handleFailedJob(deps: Deps, job: SonioxJob, ref: JobRef): Promise<SonioxEventResult> {
  try {
    await deps.tg.sendMessage(ref.chatId, job.isLink ? deps.s.linkJobFailed : deps.s.sonioxFailed, { replyTo: ref.replyTo });
  } catch (e) {
    deps.log.error('deliver_failed', { error: errorName(e) });
    return FAILED;
  }
  return answered(deps, job, ref, { openWarning: false, summarize: null });
}

async function handleCompletedJob(deps: Deps, job: SonioxJob, ref: JobRef): Promise<SonioxEventResult> {
  let tokens;
  try {
    tokens = await deps.soniox.getTokens(job.id);
  } catch (e) {
    // The transcript is gone (a concurrent delivery destroyed it) or the network failed; a retry sorts it out.
    deps.log.error('tokens_failed', { error: errorName(e) });
    return FAILED;
  }

  const segments = groupTokensIntoSegments(tokens);
  let transcript: { transcriptText: string; messageId: number } | null = null;
  try {
    if (segments.length === 0) {
      await deps.tg.sendMessage(ref.chatId, deps.s.noSpeech, { replyTo: ref.replyTo });
    } else {
      transcript = await deliverTranscript(deps, {
        chatId: ref.chatId,
        replyTo: ref.replyTo,
        segments,
        durationMs: job.durationMs,
      });
    }
  } catch (e) {
    deps.log.error('deliver_failed', { error: errorName(e) });
    return FAILED;
  }

  const wantsSummary = ref.mode === 's' && deps.summarizer !== null;
  return answered(deps, job, ref, { openWarning: true, summarize: wantsSummary ? transcript : null });
}

export async function handleSonioxEvent(
  deps: Deps,
  event: { id: string; status: 'completed' | 'error' },
): Promise<SonioxEventResult> {
  let job: SonioxJob | null;
  try {
    job = await deps.soniox.getJob(event.id);
  } catch (e) {
    deps.log.error('job_lookup_failed', { error: errorName(e) });
    return FAILED;
  }
  if (job === null) return OK;

  const ref = decodeRef(job.ref);
  if (ref === null) {
    await destroyJob(deps, job.id);
    return OK;
  }

  // The job's own status is authoritative; the webhook body is only a hint.
  if (job.status === 'error') return handleFailedJob(deps, job, ref);
  if (job.status === 'completed') return handleCompletedJob(deps, job, ref);
  // Not finished yet (queued / processing): a retry may find it finished.
  deps.log.info('job_not_finished', { status: job.status });
  return FAILED;
}
