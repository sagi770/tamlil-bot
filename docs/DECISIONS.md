# Decisions

Task numbers and spec sections mentioned below refer to the project's original design document and build plan, which are not part of this repository. Each entry is self-contained.

This file records deviations from the design spec, each with a one-line rationale.

## Soniox webhook retry policy (Task 9)

Source: https://docs.soniox.com/stt/async/webhooks and https://docs.soniox.com/stt/async/error-handling (checked 2026-11-20).

- The docs say only that when delivery fails ("your server is unavailable or does not respond in time") Soniox retries "multiple times over a short period"; if all attempts fail the webhook is marked permanently failed and the result is still retrievable by transcription id.
- Which response codes trigger a retry, the exact retry count and the intervals are NOT documented. Treat "a 5xx or a timeout makes a retry likely, a 2xx ends delivery" as an assumption. Task 13 may return 500 on a failed delivery so a retry can succeed, but must not depend on it: a delivery that keeps failing is lost; the job stays at Soniox until its automatic deletion after 30 days (source: https://soniox.com/docs/stt/async/limits-and-quotas); `npm run doctor` reports leftovers; the user resends.
- The webhook body is `{ id, status }` with status `completed` or `error`; a custom auth header is set at creation via `webhook_auth_header_name` / `webhook_auth_header_value` (confirmed in the docs and in the `@soniox/node` 2.5.0 types).

## Soniox out-of-credit signal on create (Task 9)

Sources: https://docs.soniox.com/stt/async/error-handling and https://docs.soniox.com/stt/async/async-transcription (neither mentions credit, balance or payment status codes).

Not documented on those pages. `SonioxStartError('payment')` maps HTTP 402; this is now confirmed by Soniox's errors reference (see "README facts verified (Task 17)", **Soniox out of credit**). 429 is treated as `other` because it is also a rate-limit signal.

## OpenAI summarizer model and request shape (Task 10)

Sources (checked 2026-11-20; platform.openai.com URLs 301-redirect to developers.openai.com): https://developers.openai.com/api/docs/pricing, /api/docs/models, /api/docs/models/gpt-5-nano, /api/docs/models/gpt-6-luna, /api/docs/deprecations, /api/docs/guides/latest-model, /api/reference/resources/chat/subresources/completions/methods/create.

- Chosen default: `gpt-6-luna`. Standard tier $0.10 input / $0.50 output per 1M tokens; context window 1,050,000 tokens (max input 922,000, max output 128,000); supports Chat Completions. Prompts over 272K input tokens cost 2x input and 1.5x output. Date: 2026-11-20.
- Rejected: `gpt-5-nano` ($0.05 / $0.40, 400k context) is cheaper but is deprecated with shutdown on 2026-12-11; OpenAI names `gpt-6-luna` as its replacement. `gpt-4o-mini` ($0.15 / $0.60, 128k) is dearer and older.
- `SUMMARY_MAX_INPUT_CHARS` = 922,000 x 2 = 1,844,000, capped at the brief's 600,000.
- Request: `max_completion_tokens` 8000 (`max_tokens` is deprecated and incompatible with reasoning models; the cap includes reasoning tokens) and `reasoning_effort: 'low'` to keep reasoning spend small. `temperature` is omitted: the GPT-6 migration guidance says to omit `temperature`/`top_p`, confirmed for gpt-6.2 models; the gpt-6-luna page does not say, so it is omitted as the safe choice.
- A custom `OPENAI_MODEL` must support Chat Completions with `reasoning_effort` (sent unconditionally); a rejection surfaces as `HTTP 400 (code=..., param=...)`.
- Not verified: the gpt-6-luna page does not list accepted parameters, and whether every paid account has access is not stated (it lists usage tiers Build/Launch/Grow). Verify with a live call in the end-to-end task.

## Failed Soniox delivery may never be retried (Task 13)

Because the Soniox retry policy is undocumented (see above), a failed delivery answers 500 without destroying the job, but a retry is not guaranteed. If none comes, the job stays at Soniox (doctor reports it as a leftover; Soniox deletes it after 30 days, source: https://soniox.com/docs/stt/async/limits-and-quotas) and the user must resend the recording. Everything after the user-facing result (status-message delete, destroy, open warning, summary) runs in the background (`waitUntil`), is best effort and never changes the 200.

- Concurrent duplicate webhook deliveries can still deliver a transcript twice (stateless design; the window is small because post-delivery steps now run in the background).

## Vercel CLI commands used by setup (Task 14)

Checked 2026-11-20 with `npx --yes vercel@latest <command> --help` (CLI 66.5.0) and https://vercel.com/docs/cli/env, https://vercel.com/docs/cli/link, https://vercel.com/docs/cli/inspect, plus the CLI source on GitHub (`packages/cli/src/commands/inspect/index.ts`, `util/input/input-project.ts`). The global CLI on the development machine is 66.0.0.

- Minimum version 64.6.0: `--environment` on `vercel env add/update` needs it (/docs/cli/env). An older or missing CLI fails the step with `npm i -g vercel@latest`.
- `vercel --version`; `vercel whoami` (non-zero exit when not logged in).
- `vercel link --yes --project tamlil-bot` links to that project or creates it (under `--yes`, `inputProject` returns the name to create). Skipped when `.vercel/project.json` exists. `--yes` does not pick a team. Since Task 17 (fix round 1) nobody runs `vercel link` by hand: when the link step's CLI output mentions choosing a team or scope, the agent runs `vercel teams ls` (read-only), asks which team, runs `vercel switch <team-slug>` and re-runs `npm run setup`. Syntax checked with `npx --yes vercel@latest teams --help` and `switch --help` (CLI 66.6.0, 2026-11-22): `vercel teams ls` is the alias of `vercel teams list`, and `vercel switch [name]` is `vercel teams switch [name]`, whose slug is the name in the team's URL `vercel.com/<slug>`. Not verified live. Since the final fix wave, setup's own hint for this step gives the same `vercel teams ls` / `vercel switch` steps.
- `.env.local` and `.gitignore` are restored around `vercel link`: setup reads their bytes just before `link()` and writes them back afterwards, whether link worked or not, keeping nothing link wrote. Reason: the changelog "Preserve local environment variables when linking" (https://vercel.com/changelog/preserve-local-environment-variables-when-linking-with-the-vercel-cli) says linking used to overwrite the file, and current CLIs still add `VERCEL_OIDC_TOKEN` to it; link also appends `.vercel` and `.env*` to `.gitignore` (seen live), and that `.env*` comes after `!.env.example` and would make git ignore `.env.example`. That changelog names no version, and setup accepts CLIs back to 64.6.0.
- `vercel env add <NAME> --environment production --yes`, value on stdin; if that fails (usually: it exists), `vercel env update <NAME> --environment production --yes`, value on stdin. `--sensitive` / `--type secret|config` exist but are not passed: production variables default to Secret. `env add --force` also exists; add-then-update is kept because `update` changes the variable that covers production without touching its other environments.
- After pushing, every spec 5.2 variable that is empty or absent in `.env.local` is removed from production, so deleting a line (for example `OPENAI_API_KEY`) really turns its feature off: `vercel env remove <NAME> --environment production --confirm-name <NAME>` on CLI 65.15.0 and later, `... --yes` before that. From 65.15.0 `--help` marks `--yes` "Deprecated: use --confirm-name. Agents can't approve with --yes", and setup is usually run by an agent. Checked with `--help` of 64.7.0, 65.14.0 (no `--confirm-name`), 65.15.0, 66.0.0 and 66.5.0. A variable that is not on production counts as removed: the CLI source (`commands/env/rm.ts`) answers `Environment Variable … was not found.` / reason `env_not_found`, or `The selected environment does not match this variable. No changes were made.`, with exit 1. A variable with a local value is never removed. Note: 64.6.0 is not published on npm; the first release at or above it is 64.7.0.
- `vercel deploy --prod --yes` prints the deployment URL on stdout and waits for the build.
- `vercel inspect <deploymentUrl> --json`. The URL is not a secret and passes the argument check. The JSON has `id, name, url, target, readyState` and `aliases` (= `deployment.alias`). The production URL is `<name>.vercel.app` when listed, else the shortest `*.vercel.app` alias that is neither the deployment URL nor a `-git-` alias. Custom domains are not guessed: set `PUBLIC_BASE_URL`.
- Windows: `vercel` is a `.cmd` shim and needs `shell: true`. Node 24 warns (DEP0190) when an args array is combined with `shell: true`, so on win32 the command line is joined from arguments that must match `^[A-Za-z0-9_.=:/@-]+$`. Variable values go only through stdin.
- `.vercelignore` is an allow-list (`/*`, then `!/api`, `!/src`, `!/package.json`, `!/package-lock.json`, `!/tsconfig.json`, `!/vercel.json`). Without it the "Other" preset serves the whole folder as static output, which would expose `docs/` and `.superpowers/` on the production domain. The CLI's default ignore list skips only `.env.local` / `.env.*.local`, not `.env`, `.env.production` or `.env.development`. Sources: https://vercel.com/docs/deployments/vercel-ignore (allow-list form) and https://vercel.com/docs/deployments/build-features#ignored-files-and-folders (default list).
- Not verified live: the content of `aliases` right after `deploy --prod` on a new project. Check in the live end-to-end task.

## setup and doctor details (Task 14)

- Key checks reuse the service modules (one module per service): Soniox via `countLeftovers()` instead of `models.list()`, OpenAI via one real `summarize()` call instead of `GET /v1/models`, so the check also proves the model accepts our request shape.
- `finish()` sets `process.exitCode` and ends the run by throwing to the top-level catch instead of calling `process.exit()`: on Windows with Node 24.16, `process.exit()` after `fetch` calls aborted Node with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c` and exit code 127 (observed).
- setup checks all three keys and the Vercel CLI/login before stopping, so every broken prerequisite shows up in one run, and it deploys nothing while any of them failed.
- Owner detection only reads `/start` with `getUpdates` when no webhook is set (the first run; the runbook has the user send `/start` first). Once a webhook is live it has already consumed `/start`, so setup does not delete the webhook and does not call `getUpdates`. Every "not found" path points to `/id` (the bot replies with the user's Telegram ID) and `npm run setup -- --owner-id=<ID>`. The spec's "remove the webhook temporarily" approach was dropped because "send /start and run setup again" would loop.

## Script hardening (hardening B)

- dev mode advances the `getUpdates` offset after each handled update, not per batch, so an update that throws does not cause the ones before it to be redelivered. Telegram only treats an update as confirmed when a later `getUpdates` call passes a higher `offset`, so on shutdown (Ctrl+C), when at least one update was handled, dev makes one best-effort `getUpdates({ offset, timeoutSec: 0 })` (5 s cap, failure ignored). Without it the last handled updates would be delivered again on the next run.
- A Soniox job that no longer exists (`getJob` returns null) ends the dev watcher at once with an `dev_job_missing` log line instead of polling for 15 minutes.
- `KEY= # comment` parses as an empty value (a `#` that is the first non-space character of the value starts a comment); `KEY=value # comment` still yields `value` and `KEY=a#b` keeps `a#b`. `upsertEnv` is unchanged and byte-preserving.
- doctor's default failure hint points to the README troubleshooting section instead of "run `npm run doctor`" (circular there); setup keeps the doctor hint.

## Link import — live spike (Task 2, 2026-11-22)

Run locally with the real pipeline (`normalizeMediaUrl` → `preflightMediaUrl` → Soniox `startFromUrl` with the preflighted final URL, no webhook):

| Link | Size | Preflight | Soniox | Audio duration |
|---|---|---|---|---|
| Drive share link (via the bot, 2026-11-21) | 28 MB | ok | completed | 30:17, matches |
| Drive share link | 27.4 MB | ok (`audio/mpeg`, final host drive.usercontent.google.com) | not run | — |
| Drive share link | 62.2 MB | ok (`audio/mpeg`) | completed in 50 s | 67.2 min, matches the file |
| Drive file that is not shared publicly | — | `not-media` (Drive answers with an HTML page) | not run | — |
| Drive folder link | — | rejected as `drive-folder` before any fetch | — | — |

Decision: the link flow in spec 5.3 stands (Soniox pulls the preflighted direct URL itself; the file never passes through Vercel). Not tested yet: Drive files over 100 MB (Drive may answer with a virus-scan warning page; the bot then replies with the "not a media file / check sharing" message) and Dropbox links (the `dl=1` rewrite is implemented and unit-tested, but no live Dropbox file was available). The README says both plainly.

Note: `vercel link` (run by setup) appends `.vercel` and `.env*` to `.gitignore`; the appended `.env*` comes after `!.env.example` and would ignore it. Setup now restores `.gitignore` byte-for-byte after linking, like `.env.local` (Task 16b).

## Vercel Hobby usage — measured (Task 16, 2026-11-22)

`vercel metrics`, production, first two days of live testing (voice messages, a 28 MB Drive link, a 45-minute file, summaries):

| Route | Invocations | Active CPU per call | Wall time per call | Peak memory |
|---|---|---|---|---|
| `/api/telegram` | 10 | ≤ 150 ms | ≤ 6.6 s (summary calls wait on OpenAI) | 207 MB |
| `/api/soniox` | 3 | ≤ 150 ms | ≤ 0.7 s | 219 MB |

Hobby includes 4 h Active CPU, 360 GB-h provisioned memory (functions run at 2 GB) and 1M invocations per month. One transcription with a summary costs about 3 invocations, ≤ 0.5 s CPU and ≤ ~17 s of instance time, so the CPU and memory-time allowances are the binding ones: roughly 20,000–30,000 transcriptions a month. The README states "thousands of transcriptions a month" and links here. Fluid compute may share instances between concurrent requests, which only lowers the real cost.

Live checks that passed (Task 16): voice message, two speakers, long recording as .txt, file over 20 MB refused with the link hint, Drive link (28 MB via the bot, 62 MB spike), caption "סיכום" (automatic summary), summary button on a message and on a .txt, video, stranger refused, owner lock via `--owner-id`, both endpoints 401 without the secret, no leftovers at Soniox after delivery, no secrets or transcript text in the Vercel logs. Not live-tested: round video notes, Dropbox, Drive files over 100 MB, `npm run dev`, and the configuration variants (no OpenAI key, `ALLOW_ALL_USERS=true`), which are covered by unit tests.

## Live-test fixes (Task 16b)

- `BOT_TIMEZONE` (optional, IANA name): the transcript file name used the server's clock, and Vercel runs in UTC (a 23:48 Israel message was named 21-48). Default `Asia/Jerusalem` for `BOT_LANGUAGE=he`, `UTC` for `en`; an invalid zone falls back to that default.

## README facts verified (Task 17, 2026-11-22)

Read on 2026-11-22. The READMEs state only these facts, the measured sections above, and what the code does.

- **Vercel Hobby terms.** Terms of Service, section 4 "Hobby Plan" (https://vercel.com/legal/terms, "Last Updated October 19, 2026"): "You shall only use the Services under a Hobby plan for your personal or non-commercial use." The terms do not define "commercial". The Fair Use Guidelines page (https://vercel.com/docs/limits/fair-use-guidelines, last updated 2026-11-12) as fetched has empty "Examples of fair use" / "Never fair use" lists and no definition of commercial use. Search-engine snippets of older versions quote a stricter sentence ("Hobby teams are restricted to non-commercial personal use only"); it was not found on the current page, so the READMEs quote only the Terms sentence and link both pages.
- **Vercel Hobby limits** (https://vercel.com/docs/plans/hobby, last updated 2026-11-12): free, no billing cycle; per month 4 CPU-hrs Active CPU, 360 GB-hrs Provisioned Memory, first 1,000,000 function invocations; function maximum duration 300 s; runtime logs kept 1 hour. Over a limit: "In most cases, if you exceed your usage limits on the Hobby plan, you will have to wait until 30 days have passed before you can use the feature again."
- **Soniox price** (https://soniox.com/pricing): "$0.10/hour for async (file uploads)", pay-as-you-go.
- **Soniox starting credit: none.** Soniox blog, 2025-10-27 (https://soniox.com/blog/2025-10-27-free-credits-update-for-soniox-api): "We will no longer offer free credits going forward." No minimum top-up is stated on the pricing page, the errors reference or that post, so the READMEs name none.
- **Soniox out of credit** (https://docs.soniox.com/api-reference/errors): HTTP 402 `organization_balance_exhausted`, fix "Top up at Billing overview or enable autopay" (https://console.soniox.com/org/billing/overview/). HTTP 402 is also returned for `organization_monthly_budget_exhausted` and `project_monthly_budget_exhausted` (a monthly budget cap set in the console). This confirms the 402 assumption in "Soniox out-of-credit signal on create" (Task 9). The bot answers all three with `sonioxPayment`, so the troubleshooting section mentions the budget cap too. Code unchanged.
- **Soniox API key** (https://docs.soniox.com/stt/get-started): "In the Console, go to My First Project and click API Keys to generate one."
- **Soniox limits** (https://docs.soniox.com/stt/async/limits-and-quotas): 300 minutes per file, "fixed and cannot be increased"; files and transcriptions are deleted automatically after 30 days. Formats (https://docs.soniox.com/stt/async/async-transcription): aac, aiff, amr, asf, flac, mp3, ogg, wav, webm, m4a, mp4.
- **Telegram** (https://core.telegram.org/bots/api): getFile, "For the moment, bots can download files of up to 20MB in size."; pending updates "will not be kept longer than 24 hours", so the `/start` sent before setup must be less than a day old. BotFather (https://core.telegram.org/bots/features#creating-a-new-bot): `/newbot`, and the bot's username "must end in 'bot'".
- **Claude Code** (https://code.claude.com/docs/en/quickstart): started with `claude` in the project folder; needs a Claude subscription or a Claude Console account.
- **Windows PowerShell and npm** (tested locally in a scratch folder: Windows 11, Windows PowerShell 5.1, Node 24.16, npm 11.13, execution policy undefined at every scope, which is the Windows default): `npm` resolves to `npm.ps1` and fails with "running scripts is disabled on this system". `npm.cmd` works and passes arguments after `--` (`npm.cmd run setup -- --owner-id=<ID>` reached the script as `--owner-id=<ID>`); Command Prompt and Git Bash are not affected. The READMEs and CLAUDE.md give `npm.cmd` / `vercel.cmd` as the workaround rather than changing the execution policy.
- **Dashboard-only changes are undone by setup**: the next `npm run setup` removes from production every spec variable that is empty in `.env.local`, so the READMEs and CLAUDE.md say to change `.env.local` and run setup. `openWarning` used to say to add `ALLOWED_USER_IDS` in the Vercel dashboard and redeploy; the final fix wave rewords it (see "Final fix wave").

## Final fix wave (2026-11-22)

- **Open warning text deviates from spec 5.4.** Steps 2–3 used to say "add `ALLOWED_USER_IDS` in Vercel, then Redeploy". They now say "add the line `ALLOWED_USER_IDS=<id>` to `.env.local`" and "run `npm run setup`" (the first two lines, step 1 and the Claude Code line are unchanged). Reason: the next `npm run setup` removes from production every variable that is empty in `.env.local`, so a lock added only in the dashboard would be undone. The Hebrew line keeps `.env.local` in reading order with a U+200E mark.
- **A malformed `ALLOWED_USER_IDS` keeps the bot locked.** Spec 5.4 defines locked as "`ALLOWED_USER_IDS` is not empty", but `123456789 987654321` (spaces), `@username` or `123;456` used to parse to an empty list, and the bot ran open. Now the value is split on commas and whitespace; an entry counts only when it is digits forming a positive safe integer; any non-empty value locks the bot, to its valid IDs or to nobody (a value made only of separators counts as one invalid entry). The invalid entries are kept in `Config.invalidUserIds` (not secrets): setup's Owner step and doctor's Access step fail and name them with the expected format `ALLOWED_USER_IDS=123456789,987654321`, and setup never auto-detects an owner over such a list.
- **Soniox webhook host, chosen per request.** Every public installer gets a suffixed `*.vercel.app` domain; setup registers Telegram on the alias it picks, while the runtime used to give Soniox `VERCEL_PROJECT_PRODUCTION_URL`. A different (or protected) host would leave users at "⏳ מתמלל…". Now the webhook goes to `PUBLIC_BASE_URL` when set, otherwise to the https origin of the authenticated Telegram request (`new URL(request.url).origin`, passed through `handleUpdate` to `startFromFile` / `startFromUrl`), otherwise to `VERCEL_PROJECT_PRODUCTION_URL`; still only when `SONIOX_WEBHOOK_SECRET` is set. An `http:` or unparsable URL is ignored. Dev mode passes no origin and has neither variable, so it keeps no webhook; setup's smoke test clears `publicBaseUrl` and passes no origin, so it has none either. Source: the Vercel Node.js runtime page (https://vercel.com/docs/functions/runtimes/node-js, last updated 2026-08-11, read 2026-11-22) uses `new URL(request.url)` in a `fetch` handler, so `request.url` is absolute; it does not state the scheme or that the host is the alias the client called. Not verified live yet; if the origin is not https the bot falls back to the old behaviour.
- **setup and doctor probe `/api/soniox` too.** After `/api/telegram`, both POST to `<base>/api/soniox` without the secret and expect our 401 (the Soniox handler answers the same `unauthorized` body, so the probe classifier is unchanged). A protection page fails the step with the Deployment Protection hint; other answers fail with the same hints as the Telegram probe. setup probes its production URL; doctor probes the base of the registered Telegram webhook, in a new "Webhook endpoint check" step, so a healthy doctor run now has 10 steps.
- **Answering a callback is best effort.** Telegram refuses a late `answerCallbackQuery` with 400 "query is too old" (for example after a delayed webhook delivery). The failure is logged as `callback_answer_failed` with the error class, and the summary goes on. The plain answer to an ignored or refused callback is best effort too.
- **A link alone never asks for a summary.** The summary intent of a link message is read from the text with its links removed, so `https://host/meeting-summary.mp3` alone does not start a paid summary; "סכם https://…" still does.
