// Console report for setup and doctor: one ✓ / ⚠ / ✗ line per step, an indented "→" next step
// for every problem, and a summary at the end. Every printed line passes through scrub(), so a
// registered secret never reaches the terminal, even inside a third-party error message.

type Status = 'ok' | 'warn' | 'fail';

const SYMBOL: Record<Status, string> = { ok: '✓', warn: '⚠', fail: '✗' };
const rows: { name: string; status: Status }[] = [];
const secrets = new Set<string>();
const GENERIC_HINT = 'Run the command again. If it keeps failing, run `npm run doctor` and read what it reports.';
let defaultHint = GENERIC_HINT;

/** The next step shown for a failed step that gives none. doctor points elsewhere: it is the doctor. */
export function setDefaultHint(hint: string): void {
  defaultHint = hint;
}

/** Fails a step with a specific next step for the user. */
export class StepFailure extends Error {
  readonly hint?: string;
  constructor(message: string, hint?: string) {
    super(message);
    this.name = 'StepFailure';
    this.hint = hint;
  }
}

/** Thrown by finish() to end the run; crash() recognises it. */
class Finished extends Error {}

export interface StepContext {
  /** Short, non-secret text shown after the step name on the ✓ line. */
  detail(text: string): void;
  /** Marks the step as a warning. The step still returns its value and the run continues. */
  warn(message: string, hint?: string): void;
}

/** Registers values that must never be printed. */
export function hideSecrets(values: Iterable<string | null | undefined>): void {
  for (const v of values) {
    const s = v?.trim();
    if (s && s.length >= 8) secrets.add(s);
  }
}

/** Replaces every registered secret in text, wherever it appears. */
export function scrub(text: string): string {
  let out = text;
  for (const s of secrets) out = out.split(s).join('[hidden]');
  return out;
}

function print(line = ''): void {
  console.log(scrub(line));
}

function printHint(hint: string): void {
  for (const line of hint.split('\n')) print(`    → ${line}`);
}

export function heading(title: string): void {
  print(title);
  print();
}

/** A progress note, for a step that takes a while. */
export function info(text: string): void {
  print(`  ${text}`);
}

export function hasFailures(): boolean {
  return rows.some((r) => r.status === 'fail');
}

/** Runs one step and prints its line. Returns undefined when the step failed. */
export async function step<T>(
  name: string,
  fn: (ctx: StepContext) => Promise<T> | T,
  hint?: string,
): Promise<T | undefined> {
  const state: { detail: string | null; warning: { message: string; hint?: string } | null } = {
    detail: null,
    warning: null,
  };
  const ctx: StepContext = {
    detail: (text) => {
      state.detail = text;
    },
    warn: (message, warnHint) => {
      state.warning = { message, hint: warnHint };
    },
  };
  try {
    const value = await fn(ctx);
    if (state.warning) {
      rows.push({ name, status: 'warn' });
      print(`${SYMBOL.warn} ${name}: ${state.warning.message}`);
      if (state.warning.hint) printHint(state.warning.hint);
    } else {
      rows.push({ name, status: 'ok' });
      print(`${SYMBOL.ok} ${name}${state.detail ? `: ${state.detail}` : ''}`);
    }
    return value;
  } catch (err) {
    if (err instanceof Finished) throw err;
    rows.push({ name, status: 'fail' });
    print(`${SYMBOL.fail} ${name}: ${err instanceof Error ? err.message : 'unexpected error'}`);
    const output = (err as { output?: unknown } | null)?.output;
    if (typeof output === 'string' && output) {
      for (const line of output.split('\n')) print(`      | ${line}`);
    }
    const next = err instanceof StepFailure && err.hint ? err.hint : hint;
    printHint(next ?? defaultHint);
    return undefined;
  }
}

function printSummary(footer: string[]): void {
  const count = (s: Status) => rows.filter((r) => r.status === s).length;
  print();
  print('Summary');
  for (const r of rows) print(`  ${SYMBOL[r.status]}  ${r.name}`);
  print(`  ${count('ok')} ok, ${count('warn')} warning${count('warn') === 1 ? '' : 's'}, ${count('fail')} failed`);
  if (footer.length > 0) {
    print();
    for (const line of footer) print(line);
  }
  print();
  if (hasFailures()) print('Not done yet: fix the items marked ✗ (each has a → next step), then run the command again.');
  process.exitCode = hasFailures() ? 1 : 0;
}

/**
 * Prints the summary, sets exit code 1 if any step failed (warnings do not fail), and ends the
 * run by throwing to the script's top-level `.catch(crash)`. It does not call process.exit():
 * on Windows that can abort Node while fetch connections are closing (libuv async.c assertion).
 */
export function finish(footer: string[] = []): never {
  printSummary(footer);
  throw new Finished('finished');
}

/**
 * The scripts' top-level catch: ignores finish(), prints anything else without a stack trace.
 * `footer` is the same provider the script gives finish() (bot link, access line).
 */
export function crash(err: unknown, footer: () => string[] = () => []): void {
  if (err instanceof Finished) return;
  rows.push({ name: 'Unexpected error', status: 'fail' });
  print(`${SYMBOL.fail} Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
  let lines: string[] = [];
  try {
    lines = footer();
  } catch {
    // The footer is a courtesy; never let it hide the real error.
  }
  printSummary(lines);
}
