import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

// Verified against Vercel CLI 66.5.0 --help and https://vercel.com/docs/cli (see docs/DECISIONS.md).
// `env add/update --environment` needs 64.6.0 or later.
export const MIN_CLI_VERSION = '64.6.0';
// `env remove --confirm-name` exists from 65.15.0 (checked with --help of 65.14.0 and 65.15.0).
const CONFIRM_NAME_VERSION = '65.15.0';
export const PROJECT_NAME = 'tamlil-bot';
export const INSTALL_HINT = 'Install or update the Vercel CLI: npm i -g vercel@latest';
const PROJECT_FILE = '.vercel/project.json';

/** A failed `vercel` command. `output` is the tail of what the CLI printed, for the user to read. */
export class VercelCliError extends Error {
  readonly output: string;
  constructor(message: string, output = '') {
    super(message);
    this.name = 'VercelCliError';
    this.output = output;
  }
}

const ANSI = /\u001b\[[0-9;]*m/g;
const stripAnsi = (s: string) => s.replace(ANSI, '');

export function parseCliVersion(output: string): string | null {
  return /(\d+)\.(\d+)\.(\d+)/.exec(stripAnsi(output))?.[0] ?? null;
}

export function isAtLeast(version: string, min: string): boolean {
  const a = version.split('.').map(Number);
  const b = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

/** `vercel deploy` prints the deployment URL on stdout. */
export function parseDeploymentUrl(stdout: string): string | null {
  return stripAnsi(stdout).match(/https:\/\/[A-Za-z0-9.-]+/g)?.at(-1) ?? null;
}

const host = (s: string) => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

/**
 * Picks the project's production domain from `vercel inspect --json` output: `<name>.vercel.app`
 * when assigned, else the shortest `*.vercel.app` alias that is neither the per-deployment URL
 * nor a Git branch alias. Custom domains are not guessed: set PUBLIC_BASE_URL for those.
 */
export function pickProductionAlias(inspect: unknown): string | null {
  if (typeof inspect !== 'object' || inspect === null) return null;
  const { url, name, aliases } = inspect as { url?: unknown; name?: unknown; aliases?: unknown };
  if (!Array.isArray(aliases)) return null;
  const deployment = typeof url === 'string' ? host(url) : '';
  const candidates = aliases
    .filter((a): a is string => typeof a === 'string')
    .map(host)
    .filter((h) => h.endsWith('.vercel.app') && h !== deployment && !h.includes('-git-'));
  const own = typeof name === 'string' ? candidates.find((h) => h === `${name.toLowerCase()}.vercel.app`) : undefined;
  const pick = own ?? [...candidates].sort((x, y) => x.length - y.length || x.localeCompare(y))[0];
  return pick ? `https://${pick}` : null;
}

interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

// Arguments are fixed strings, variable names and the (public) deployment URL; values go through stdin.
const SAFE_ARG = /^[A-Za-z0-9_.=:/@-]+$/;

function run(args: string[], opts: { input?: string; timeoutMs?: number } = {}): RunResult {
  for (const arg of args) {
    if (!SAFE_ARG.test(arg)) throw new Error('Refusing to pass an unexpected argument to vercel');
  }
  const options = {
    input: opts.input ?? '',
    encoding: 'utf8' as const,
    timeout: opts.timeoutMs ?? 120_000,
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: '1' },
  };
  // On Windows `vercel` is a .cmd shim and needs a shell. The arguments were checked above, so
  // one command line is safe, and it avoids Node's DEP0190 warning for args combined with a shell.
  const r =
    process.platform === 'win32'
      ? spawnSync(['vercel', ...args].join(' '), { ...options, shell: true })
      : spawnSync('vercel', args, options);
  const timedOut = (r.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT';
  return { ok: !r.error && r.status === 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '', timedOut };
}

function tail(r: RunResult, lines = 6): string {
  return stripAnsi(r.stderr.trim() || r.stdout.trim())
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean)
    .slice(-lines)
    .join('\n');
}

function failure(what: string, r: RunResult): VercelCliError {
  return new VercelCliError(r.timedOut ? `${what} timed out` : `${what} failed`, tail(r));
}

let installedVersion: string | null | undefined;

/** The installed CLI version, or null when `vercel` is not installed. Asked once per run. */
export function version(): string | null {
  if (installedVersion === undefined) {
    const r = run(['--version'], { timeoutMs: 60_000 });
    installedVersion = r.ok ? parseCliVersion(`${r.stdout}\n${r.stderr}`) : null;
  }
  return installedVersion;
}

/** The logged-in username, or null when not logged in. */
export function whoami(): string | null {
  const r = run(['whoami'], { timeoutMs: 60_000 });
  if (!r.ok) return null;
  return stripAnsi(r.stdout).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).at(-1) ?? null;
}

/** Reads `.vercel/project.json` (written by `vercel link`); null when this folder is not linked. */
export function readLink(): { projectId: string; projectName: string | null } | null {
  if (!existsSync(PROJECT_FILE)) return null;
  try {
    const data = JSON.parse(readFileSync(PROJECT_FILE, 'utf8')) as { projectId?: unknown; projectName?: unknown };
    if (typeof data.projectId !== 'string') return null;
    return { projectId: data.projectId, projectName: typeof data.projectName === 'string' ? data.projectName : null };
  } catch {
    return null;
  }
}

/** Links this folder to the project, creating it when it does not exist yet. */
export function link(): void {
  const r = run(['link', '--yes', '--project', PROJECT_NAME]);
  if (!r.ok) throw failure('vercel link', r);
}

/** Sets a production variable. The value goes through stdin, never the command line. */
export function setEnv(name: string, value: string): void {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error('Invalid environment variable name');
  const add = run(['env', 'add', name, '--environment', 'production', '--yes'], { input: value });
  if (add.ok) return;
  // Most often the variable already exists; `env update` replaces its value.
  const update = run(['env', 'update', name, '--environment', 'production', '--yes'], { input: value });
  if (!update.ok) throw setEnvFailure(name, tail(add), tail(update), update.timedOut);
}

/**
 * The error for a variable that could not be saved. When `env add` failed for a reason other than
 * "already exists", its output is shown too, so the real cause is visible. The report scrubs
 * every printed line, so a registered secret in either output never reaches the terminal.
 */
export function setEnvFailure(name: string, addOutput: string, updateOutput: string, timedOut = false): VercelCliError {
  const message = `Saving ${name} to Vercel ${timedOut ? 'timed out' : 'failed'}`;
  if (/already exists|ENV_ALREADY_EXISTS/i.test(addOutput)) return new VercelCliError(message, updateOutput);
  return new VercelCliError(message, `env add: ${addOutput}\nenv update: ${updateOutput}`);
}

/**
 * Arguments that remove a production variable without a prompt. From 65.15.0 `--yes` is deprecated
 * for `env remove` and refused when an agent runs the CLI; `--confirm-name <NAME>` replaces it.
 */
export function envRemoveArgs(name: string, cliVersion: string): string[] {
  const confirm = isAtLeast(cliVersion, CONFIRM_NAME_VERSION) ? ['--confirm-name', name] : ['--yes'];
  return ['env', 'remove', name, '--environment', 'production', ...confirm];
}

/** True when `env remove` failed only because production has no such variable. */
export function isMissingVariable(output: string): boolean {
  return /env_not_found|was not found|does not match this variable/i.test(output);
}

/** Removes a production variable. Returns false when it was not there (not an error). */
export function removeEnv(name: string): boolean {
  if (!/^[A-Z][A-Z0-9_]*$/.test(name)) throw new Error('Invalid environment variable name');
  const cliVersion = version();
  if (!cliVersion) throw new VercelCliError('the Vercel CLI is not installed');
  const r = run(envRemoveArgs(name, cliVersion));
  if (r.ok) return true;
  if (isMissingVariable(`${r.stdout}\n${r.stderr}`)) return false;
  throw failure(`Removing ${name} from Vercel`, r);
}

/** Deploys to production and returns the deployment URL. */
export function deployProd(): string {
  const r = run(['deploy', '--prod', '--yes'], { timeoutMs: 15 * 60_000 });
  if (!r.ok) throw failure('vercel deploy', r);
  const url = parseDeploymentUrl(r.stdout);
  if (!url) throw new VercelCliError('vercel deploy did not print a deployment URL', tail(r));
  return url;
}

/** The production domain (https://<alias>) of a deployment. The URL is not a secret and passes SAFE_ARG. */
export function productionUrl(deploymentUrl: string): string {
  const r = run(['inspect', deploymentUrl, '--json']);
  if (!r.ok) throw failure('vercel inspect', r);
  let data: unknown;
  try {
    data = JSON.parse(r.stdout.slice(r.stdout.indexOf('{'), r.stdout.lastIndexOf('}') + 1));
  } catch {
    throw new VercelCliError('vercel inspect did not return JSON', tail(r));
  }
  const url = pickProductionAlias(data);
  if (!url) throw new VercelCliError('Could not find the production domain of the deployment');
  return url;
}
