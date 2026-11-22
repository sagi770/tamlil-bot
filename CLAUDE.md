# CLAUDE.md

Instructions for Claude Code, and for any other coding agent through `AGENTS.md`. This file is the single source.

- **Part 1** is how to work in the code.
- **Part 2** is the install runbook. Follow it whenever the user asks to build, install, set up, deploy or connect the bot, in any wording or language: "build me the app", "תבנה לי את האפליקציה", "install the bot", "תתקין את הבוט", "תעלה את הבוט", and so on.

## Hard rules

These apply in every session, in both parts:

- Never ask the user to paste a key into the chat, and never print a key's value.
- Never finish an install while the bot is open with a warning without asking the user explicitly.
- Speak to the user in their language.
- Run lint, typecheck and tests before changing code.

What follows from them:

- Never read `.env.local` and never show its values: no Read tool, `cat`, `type`, `Get-Content`, `grep`, `head` and no `vercel env pull`. The screen may be recorded. To see which variables are filled, run the [names-only check](#check-which-variables-are-filled). To set a non-secret variable, use the [set helper](#set-a-non-secret-variable).
- Never run `vercel link`, `vercel deploy` or `vercel env` yourself, and never ask the user to run them. `npm run setup` does all three with the safety steps: it puts `.env.local` and `.gitignore` back byte for byte after linking, passes values through stdin, and removes cleared variables. The only `vercel` commands you run are `vercel --version`, `vercel whoami`, `vercel login`, and for an [account with several teams](#vercel-account-with-several-teams) `vercel teams ls` and `vercel switch <team-slug>`.
- If the user pastes a key into the chat anyway: do not repeat it and do not use it in a command. Tell them it is now in the chat history, suggest revoking it and creating a new one, and have them paste the new one into `.env.local`.
- Never commit `.env.local`. Never push, publish or create a repository unless the user asks.

# Part 1: Working in the code

## What this is

A Telegram transcription bot: two stateless Vercel Functions, no framework, no database, no Blob, no cron.

- `api/telegram.ts` (handler in `src/http.ts`) checks Telegram's secret header with `safeEqual`, answers 200 at once, and in `waitUntil` hands the audio to Soniox: a Telegram file (up to 20 MB) is streamed from Telegram to Soniox's file upload; a link is normalized, preflighted (headers only, guarded redirects) and passed to Soniox as `audio_url`. The job carries a Soniox webhook and a `client_reference_id` with the chat context: `v1|chatId|replyToMessageId|statusMessageId|mode` (`t` transcript, `s` transcript then summary). The webhook goes to `PUBLIC_BASE_URL` when it is set, otherwise to the https host Telegram called (the one setup registered), otherwise to `VERCEL_PROJECT_PRODUCTION_URL`.
- `api/soniox.ts` (handler in `src/http.ts`) checks Soniox's secret header, reads the job (the job's status is authoritative), delivers the transcript, answers 200, and in the background deletes the status message, destroys the job at Soniox, sends the open warning if needed and runs the summary. A failed delivery answers 500 without destroying the job.
- The summary button reads the transcript back from the Telegram message (its text, or the `.txt` file the bot sent), so it needs no state.

Deviations from the original design, verified external facts and live measurements are in `docs/DECISIONS.md`.

## Commands

| Command | What it does | Network |
|---|---|---|
| `npm run check` | lint + typecheck + all tests. Run it before and after every code change. | none |
| `npm test` | all tests (vitest) | none |
| `npx vitest run tests/<name>.test.ts` | one test file | none |
| `npm run lint`, `npm run typecheck` | one of the three checks | none |
| `npm run setup` | validates the keys, generates the webhook secrets, locks the bot to the owner, links the Vercel project `tamlil-bot`, pushes the variables to production, deploys, registers the webhook and command menu, probes both endpoints (`/api/telegram` and `/api/soniox`), runs a Soniox smoke test. Non-interactive, safe to repeat, never prints a secret. `npm run setup -- --owner-id=<ID>` locks the bot when `ALLOWED_USER_IDS` is empty. | Telegram, Soniox, OpenAI, Vercel |
| `npm run doctor` | read-only health check, 10 steps; probes both endpoints without the secret | Telegram, Soniox, one OpenAI call, the bot's own endpoints |
| `npm run dev` | runs the bot locally with long polling from `.env.local`. Refuses if the token has a webhook, unless `npm run dev -- --takeover` (which disconnects the deployed bot until the next setup). | Telegram, Soniox, OpenAI |

Windows: if a command fails with "running scripts is disabled on this system" (Windows PowerShell blocks `npm.ps1`), use `npm.cmd`, `npx.cmd` and `vercel.cmd` with the same arguments, or the Bash tool. Arguments after `--` reach the script either way.

## File map

```
api/telegram.ts            Vercel entry: createTelegramHandler + waitUntil
api/soniox.ts              Vercel entry: createSonioxHandler + waitUntil
src/http.ts                the two HTTP handlers (secret check, 401/400/405/500), framework-free
src/deps.ts                builds Deps from process.env (memoized per instance)
src/config.ts              env -> Config, defaults (DEFAULT_OPENAI_MODEL, time zone)
src/access.ts              access mode: locked / open-warn / open (pure)
src/handle-update.ts       Telegram update routing: commands, media, links, summary button
src/handle-soniox.ts       Soniox completion: deliver, then background follow-up
src/deliver.ts             transcript (message or .txt), summary, open warning
src/format.ts              segments -> message / file / footer; MESSAGE_TEXT_LIMIT 3500 (pure)
src/segments.ts            Soniox tokens -> speaker segments (pure, from tamlil)
src/intent.ts              "summary" words in a caption (pure)
src/media.ts               media extraction and the 20 MB check (pure)
src/media-url.ts           link normalization: Drive, Dropbox, YouTube/folder rejection, host guard (pure)
src/media-fetch.ts         link preflight: manual redirects, each hop re-checked, HTML rejected
src/reference.ts           client_reference_id codec (pure)
src/telegram.ts            the only Telegram HTTP client
src/soniox.ts              the only Soniox gateway, webhook verification, SONIOX_WEBHOOK_HEADER
src/summarize.ts           the only OpenAI client (Chat Completions, fetch)
src/log.ts                 primitive-only JSON logger
src/secure.ts              safeEqual
src/types.ts, telegram-types.ts
src/strings/index.ts       Strings interface + getStrings
src/strings/he.ts, en.ts   every user-facing text
src/strings/stamp.ts       file-name date stamp in a time zone
scripts/setup.ts           npm run setup (SPEC_VARS: the variables pushed to Vercel)
scripts/doctor.ts          npm run doctor
scripts/dev.ts             npm run dev
scripts/lib/checks.ts      checks and hints shared by setup and doctor: keys, ALLOWED_USER_IDS, endpoint probes (SECRET_VARS)
scripts/lib/env-file.ts    .env.local parse / upsert / byte-exact restore
scripts/lib/vercel-cli.ts  every vercel command (version gates, safe args, stdin values)
scripts/lib/telegram-admin.ts  setup-only Telegram methods (getUpdates, setWebhook, ...)
scripts/lib/owner.ts       finds the owner's /start in getUpdates
scripts/lib/probe.ts       classifies the webhook endpoint probe (ours / protected / ...)
scripts/lib/report.ts      ✓ ⚠ ✗ console report, secret scrubbing
scripts/lib/dev-logic.ts   pure parts of dev mode
tests/**                   vitest, no network; tests/scripts/** for scripts/lib
tests/helpers/fakes.ts     FakeTelegram, FakeSoniox, makeDeps
.env.example               every variable with a comment
.vercelignore              allow-list of what is deployed
vercel.json                maxDuration 300 for api/*.ts
```

## Project rules

Binding for every change:

- Node `>=22`. `"type": "module"`. Relative imports end in `.js`. No path aliases: Vercel's Node runtime does not support path mappings inside `/api`.
- Runtime dependencies are exactly `@soniox/node` and `@vercel/functions`. A third needs an entry in `docs/DECISIONS.md`.
- One module per external service. Telegram HTTP only in `src/telegram.ts` (setup-only methods in `scripts/lib/telegram-admin.ts`), Soniox only in `src/soniox.ts`, OpenAI only in `src/summarize.ts`. Pure modules touch neither the network nor environment variables.
- Every user-facing string lives in `src/strings/he.ts` and `src/strings/en.ts`. Messages are plain text: no `parse_mode`, no Markdown.
- Never log transcript text, secrets, tokens, or the Telegram file URL (it contains the bot token). The logger accepts primitive values only; log error class names, never error messages.
- Secrets are compared with `safeEqual` (constant time).
- The bot answers in private chats only.
- Environment variable names are fixed: `TELEGRAM_BOT_TOKEN`, `SONIOX_API_KEY`, `TELEGRAM_WEBHOOK_SECRET`, `SONIOX_WEBHOOK_SECRET`, `ALLOWED_USER_IDS`, `ALLOW_ALL_USERS`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `BOT_LANGUAGE`, `BOT_TIMEZONE`, `LANGUAGE_HINTS`, `SONIOX_MODEL`, `SONIOX_CONTEXT`, `PUBLIC_BASE_URL` (the same list as `SPEC_VARS` in `scripts/setup.ts`; `BOT_TIMEZONE` was added later, see `docs/DECISIONS.md`). The code also reads `VERCEL_PROJECT_PRODUCTION_URL`, which Vercel sets.
- Soniox defaults: model `stt-async-v5`, language hints `he,en`, speaker diarization and language identification on.
- Fixed values: Telegram download limit `20 * 1024 * 1024` bytes; message-vs-file threshold `3500` characters; function `maxDuration` `300`.
- No partial result is ever delivered silently as if it were complete.
- Anything not verified (external API behaviour, CLI flags, limits) is checked against official docs or `--help` before relying on it, and recorded in `docs/DECISIONS.md` with its source.
- Git: line endings are LF (`.gitattributes`). Never commit `.env.local`.

## Strings

Both language files implement the `Strings` interface in `src/strings/index.ts`; change both together. User-facing errors carry no technical detail. `tests/strings.test.ts` pins some copy (both open warnings, labels the formatter depends on, the agreed Hebrew and English wording), so a wording change updates those tests too.

## Testing without network

- Tests live in `tests/**/*.test.ts`; vitest runs with `globals: true`, so import only the module under test (relative path ending in `.js`).
- `tests/helpers/fakes.ts`: `FakeTelegram` and `FakeSoniox` record every call in `.calls` and accept per-test `handlers`; `makeDeps({ env, ... })` builds a full `Deps` from env overrides.
- Every network seam is injectable: `createTelegramHandler(getDeps, waitUntil)` / `createSonioxHandler(...)` take a fake `waitUntil`; `createSummarizer(config, fetchImpl)`; `preflightMediaUrl(url, { fetchImpl })`; `createSonioxGateway(config, client)`; `handleUpdate(deps, update, { preflight, webhookBase })`.
- Never call a real service from a test.

## Changing configuration

A new or renamed environment variable touches all of: `src/config.ts`, `SPEC_VARS` in `scripts/setup.ts` (otherwise it never reaches Vercel, and an empty one is not removed), `SECRET_VARS` in `scripts/lib/checks.ts` if it is a secret, `.env.example`, the environment variable tables in `README.md` and `README.he.md`, the list of names under [Project rules](#project-rules), and a line in `docs/DECISIONS.md`.

## Deployment facts

- `.vercelignore` is an allow-list: only `api/`, `src/`, `package.json`, `package-lock.json`, `tsconfig.json` and `vercel.json` are uploaded. A new runtime folder must be added there.
- Production variables come only from `.env.local`, through `npm run setup`: a variable with a value is saved, an empty or missing one is removed from production. A change made only in the Vercel dashboard is undone by the next setup.
- To deploy a code change: `npm run check`, then `npm run setup`.

## Docs to keep in sync

- `README.md` and `README.he.md` have the same structure and facts. Every claim matches the code or has a source in `docs/DECISIONS.md`; prices carry an "as of" date. The section titled "Troubleshooting" / "פתרון תקלות" is where doctor's default hint points.
- Part 2 below must match setup's real behaviour: step names, hints and the order of steps.

# Part 2: Install runbook

The user is often not a developer and often speaks Hebrew. You run every command. The user only creates the bot in @BotFather, gets the keys and pastes them into `.env.local`, approves `vercel login` in the browser, sends `/start`, and sends a test message.

Before step 1, tell the user in two or three sentences what will happen and what they need: Telegram (a phone is fine), a Soniox account with credit, a free Vercel account, and for summaries an OpenAI API key. Then go one step at a time, and wait for the user wherever a step needs them.

All commands run from the project root. On Windows prefer the Bash tool; in PowerShell see the `.cmd` note in [Commands](#commands).

## Step 1: Checks

1. `node --version`. Needs v22 or later. If it is missing or older, ask the user to install Node.js 22 or later from https://nodejs.org and restart Claude Code, then stop until they have.
2. `npm install`.
3. `vercel --version`. Needs 64.6.0 or later. If it is missing or older, tell the user you are installing the Vercel CLI and run `npm i -g vercel@latest`. If that fails, show the user the error and ask them to run the same command in their own terminal.
4. `vercel whoami`. A username means logged in. A non-zero exit means logged out:
   - If the user has no Vercel account, ask them to create a free one at https://vercel.com/signup.
   - Run `vercel login` in the background (it waits until the user approves). It prints a link and a code. Show both to the user: "Open this link on your computer or phone, check that the code matches, and approve. Tell me when you're done."
   - When they confirm, run `vercel whoami` again.

## Step 2: Two questions

Ask both in one message:

1. Do you want summaries too? They need an OpenAI API key with credit, and each summary costs a little (default model `gpt-6-luna`: $0.10 per 1M input tokens, $0.50 per 1M output tokens, as of 2026-11-20). Without a key the bot only transcribes and never mentions summaries.
2. Which language should the bot speak, Hebrew or English? Suggest the user's language.

## Step 3: `.env.local`

```bash
test -f .env.local && echo exists || echo missing
```

- **missing:** `cp .env.example .env.local`. Then, with the [set helper](#set-a-non-secret-variable): always set `BOT_LANGUAGE` to the user's answer, `he` or `en`; for summaries, `OPENAI_API_KEY` = `''` (this turns the commented-out line into an empty `OPENAI_API_KEY=` for the user to fill).
- **exists:** never overwrite or recreate it. Run the [names-only check](#check-which-variables-are-filled) and set `BOT_LANGUAGE` to `he` or `en` as above. For `OPENAI_API_KEY`: if they want summaries and it shows `empty`, set it to `''` as above; if it shows `filled`, leave it alone (setting it would erase the key). If they do not want summaries and it shows `filled`, set it to `''`. Ask the user only for what is still empty.

Open the file for the user:

- Windows: `powershell.exe -NoProfile -Command "Start-Process notepad .env.local"`
- macOS: `open -e .env.local`
- Linux: `xdg-open .env.local`

If no window opens, give the user the full path (`pwd`, plus `/.env.local`) and ask them to open it in any text editor.

Tell the user, in their language:

> I opened `.env.local`. Paste each value right after the `=` sign, with no spaces or quotes, save the file, and tell me "done". Please don't paste keys here in the chat.
>
> 1. `TELEGRAM_BOT_TOKEN`: in Telegram, open @BotFather, send `/newbot`, choose a name, then a username that ends in `bot`. BotFather answers with a token: copy it. Keep the bot's `t.me/...` link; you'll need it in a moment.
> 2. `SONIOX_API_KEY`: sign up at https://console.soniox.com, open *My First Project* → *API Keys* and create a key. Then add credit under Billing (https://console.soniox.com/org/billing/overview/). New accounts get no free credit; transcription costs $0.10 per hour of audio (as of 2026-11-22).
> 3. Only for summaries, `OPENAI_API_KEY`: create a key at https://platform.openai.com/api-keys. The account needs API credit.

When the user says done, run the names-only check. If `TELEGRAM_BOT_TOKEN` or `SONIOX_API_KEY` is empty (or `OPENAI_API_KEY`, when they want summaries), say which one and wait. Do not go on with an empty required key.

## Step 4: `/start` before setup

Tell the user:

> Open your new bot in Telegram (the `t.me/...` link from BotFather) and send `/start`. It won't answer yet; that's expected. This lets setup recognize you and lock the bot to you, so nobody else can use it on your balance. Tell me when you've sent it.

Telegram keeps the message for 24 hours. If more time passes before step 5, ask them to send `/start` again.

## Step 5: `npm run setup`

Tell the user it takes a few minutes (the deploy usually takes one to three, the Soniox sample transcription up to three). Run:

```bash
npm run setup
```

in the background, and wait until it exits. Do not run it in the foreground with a timeout: the deploy alone can take up to 15 minutes. Never start a second setup while one is running. Read the whole output: one ✓ / ⚠ / ✗ line per step, and under every ⚠ or ✗ a `→` line with the next step (a failed Vercel command also prints its output on `|` lines). Do what you can yourself, relay what needs the user in their language, and run setup again until the summary says `0 failed`. A full successful run has 17 steps.

When the Owner line says `locked to …` (with `@<username> (Telegram id <ID>)`, or just `Telegram id <ID>` when the owner has no username), read back whatever identity it shows and ask whether that is them. A reused bot token may have old `/start` messages from other people queued, and setup takes the most recent one. If it is not them: once the bot is live, ask them to send it any message; the refusal shows their ID. Set `ALLOWED_USER_IDS` to that ID with the [set helper](#set-a-non-secret-variable) and run `npm run setup` again.

| Output | What to do |
|---|---|
| `✗ Read .env.local: missing ...` | Back to step 3 for that key. |
| `✗ Telegram bot token: Telegram rejected the bot token` | The user copies the token again from @BotFather (`/mybots` → the bot → API Token) into `.env.local`. |
| `✗ Soniox API key: Soniox rejected the API key` | The user creates or copies a key in the Soniox console into `.env.local`. |
| `✗ OpenAI summaries: ...` | Follow the `→` hint (key, credit or model). If the user would rather skip summaries, set `OPENAI_API_KEY` to `''` with the set helper. |
| `✗ Vercel CLI: ...` | `npm i -g vercel@latest`. |
| `✗ Vercel login: not logged in` | The login flow from step 1. |
| `✗ Vercel project` | Read the `\|` lines under it (the Vercel CLI's own message). If they mention choosing a team or scope: [Vercel account with several teams](#vercel-account-with-several-teams). Otherwise relay the message in the user's language, fix what it asks for if you can, and point them to the README's "Troubleshooting" section. |
| `✗ Webhook endpoint check: ... Vercel Deployment Protection ...` | The step probes `/api/telegram` and `/api/soniox`; Telegram and Soniox both need to reach them. Ask the user to open the Vercel dashboard → project `tamlil-bot` → Settings → Deployment Protection and turn it off for production (or to give you a public domain for `PUBLIC_BASE_URL`). Then run setup again. |
| `✗ Soniox test transcription: Soniox needs credit on your account` | The user adds credit in the Soniox console. Run setup again. |
| `✗ Owner (who may use the bot): ALLOWED_USER_IDS has entries that are not Telegram IDs: ...` | The bot stays locked, but the list is broken. Ask the user for the numeric IDs (each person gets theirs with `/id`, or from the refusal message), set `ALLOWED_USER_IDS` to them separated by commas with the set helper, and run setup again. |
| `⚠ Owner (who may use the bot): ...` | [Lock the bot to the owner](#lock-the-bot-to-the-owner). |
| `⚠ Ready message: could not message ...` | Not a failure. Ask the user to send `/start` to the bot. |
| `✗ Deploy to production` | Read the `\|` lines. If the build fails on the code, run `npm run check` and fix it; otherwise show the user the error. |

Done means: `0 failed`, and the footer says `Access:   locked to one Telegram user: <ID>`. The footer line `Your bot: https://t.me/<username>` is the bot's link.

If the `Access:` line says `OPEN TO EVERYONE`, the install is not done (hard rule). Lock it (next section), or ask the user explicitly: "The bot is open to everyone: anyone who finds it can transcribe on your balance. Shall I lock it to you (recommended), or do you want it public on purpose?" Only on an explicit "public": set `ALLOWED_USER_IDS` to `''` and `ALLOW_ALL_USERS` to `true` with the set helper, and run setup again.

## Lock the bot to the owner

Setup could not read the user's `/start`. Which fix depends on the text of the `⚠ Owner` line:

- **"the bot is already live, so setup cannot read your /start"**: ask the user to send `/id` to the bot. It answers "ה-ID שלך בטלגרם: <ID>" / "Your Telegram ID: <ID>" (the open warning after `/start` shows the ID too). Then run `npm run setup -- --owner-id=<ID>`.
- **"no /start message found"** (none was sent, or it is older than 24 hours): ask the user to send `/start` to the bot, then run `npm run setup` again. If that same run went on to `✓ Telegram webhook`, the bot is live now and the next run would only say "already live": use the `/id` fix above instead.

Check that the `Access:` line now says `locked to one Telegram user`. The `--owner-id` flag only works while `ALLOWED_USER_IDS` is empty; when it is set, setup ignores the flag with a ⚠, and you change the list with the set helper instead. While `ALLOW_ALL_USERS=true`, setup skips the owner step altogether: set `ALLOW_ALL_USERS` to `''` first.

## Step 6: `npm run doctor` and a live test

```bash
npm run doctor
```

A healthy bot ends with `10 ok, 0 warnings, 0 failed`. Fix every ✗ or ⚠ by its `→` hint; `✗ Access mode: the bot is open to everyone` means [lock it](#lock-the-bot-to-the-owner).

Then ask the user to send the bot a short voice message. Expected: "⏳ מתמלל…" / "⏳ Transcribing…", then a reply with the transcript whose last line starts with `⏱`; with summaries, a "📋 סכם" / "📋 Summarize" button under it (ask them to press it). Ask what they got.

- No answer at all: run `npm run doctor` again (the "Telegram webhook" line shows Telegram's last delivery error) and use the README's "Troubleshooting" section.
- "יתרת התמלול נגמרה…" / "The transcription credit has run out…": the Soniox balance is empty, or a monthly budget cap set in the Soniox console was reached.

When it works, tell the user:

- The bot's link, and that it is locked to them.
- To let someone else use it: that person sends `/id` to the bot (or reads their ID in the refusal message) and gives it to the user; you add it (see [Later requests](#later-requests)).
- Soniox charges their balance $0.10 per hour of audio (as of 2026-11-22); with summaries, OpenAI charges per summary.
- `npm run doctor` checks everything at any time; the README's "Troubleshooting" section covers the common problems.

Do not commit or push anything.

## Later requests

- **"Lock the bot to ID <ID>" / "תנעל את הבוט ל-ID <ID>"** (the open warning suggests this sentence, next to adding `ALLOWED_USER_IDS=<ID>` to `.env.local` and running `npm run setup`): `npm run setup -- --owner-id=<ID>`. If `ALLOWED_USER_IDS` is already set (for example the user added the line themselves), the flag is ignored: ask the user for the complete list of IDs, set it with the set helper, and run `npm run setup`.
- **Add or remove people:** ask for the complete list of IDs, the owner's included (each person can get theirs with `/id`, or from the refusal message). Set `ALLOWED_USER_IDS` to the comma-separated list with the set helper, then `npm run setup`.
- **Summaries on:** if the names-only check shows `OPENAI_API_KEY: empty`, set it to `''` with the set helper (this uncomments the line), open `.env.local` for the user to paste the key, then `npm run setup`. **Off:** set `OPENAI_API_KEY` to `''`, then `npm run setup`.
- **Bot language:** set `BOT_LANGUAGE` to `he` or `en`, then `npm run setup` (it also updates the command menu).
- **Public on purpose:** only on the user's explicit request, after explaining that anyone can then transcribe on their balance: `ALLOWED_USER_IDS` = `''`, `ALLOW_ALL_USERS` = `true`, then `npm run setup`.
- **Update to a newer version:** `git pull`, `npm install`, `npm run check`, `npm run setup`.
- **Something is wrong:** `npm run doctor`, then the README's "Troubleshooting" section.
- **A change in the Vercel dashboard:** it is undone by the next setup. Make the change in `.env.local` and run `npm run setup`.

## Helpers

Run these from the project root in bash (on Windows, the Bash tool). They never print a value.

### Check which variables are filled

```bash
npx tsx -e "import('./scripts/lib/env-file.ts').then(({ parseEnv, readEnvFile }) => { const text = readEnvFile(); if (text === null) return console.log('.env.local not found'); const env = parseEnv(text); for (const name of ['TELEGRAM_BOT_TOKEN', 'SONIOX_API_KEY', 'OPENAI_API_KEY', 'ALLOWED_USER_IDS', 'ALLOW_ALL_USERS', 'BOT_LANGUAGE']) console.log(name + ': ' + (env[name] ? 'filled' : 'empty')); })"
```

It prints one `NAME: filled` or `NAME: empty` line per variable, using the same parser as setup (comments and quotes handled).

### Set a non-secret variable

```bash
npx tsx -e "import('./scripts/lib/env-file.ts').then(({ readEnvFile, upsertEnv, writeEnvFile }) => writeEnvFile(upsertEnv(readEnvFile() ?? '', 'BOT_LANGUAGE', 'en')))"
```

Replace `'BOT_LANGUAGE'` and `'en'`. It replaces the variable's line, or fills an empty commented-out `# NAME=` line, or appends one; every other byte of the file stays as it was. Use it only for non-secret values (`BOT_LANGUAGE`, `ALLOWED_USER_IDS`, `ALLOW_ALL_USERS`, `BOT_TIMEZONE`, `LANGUAGE_HINTS`, `SONIOX_MODEL`, `OPENAI_MODEL`, `PUBLIC_BASE_URL`) and for the empty value `''`. Never put a key in it. The value is written without quotes, so for free text such as `SONIOX_CONTEXT` ask the user to edit the line themselves, in double quotes.

### Vercel account with several teams

Use this only when setup's "Vercel project" step fails and the `|` lines under it (the Vercel CLI's output) mention choosing a team or scope. Setup links with `--yes`, which does not pick a team, so you switch the CLI to the right team first:

1. Run `vercel teams ls` (read-only) and show the user the teams it lists.
2. Ask which team the bot should live in. The slug is the name in the team's URL, `vercel.com/<slug>`.
3. Run `vercel switch <team-slug>`. Tell the user this keeps the Vercel CLI on that team for later commands too.
4. Run `npm run setup` again.

Never run `vercel link` and never ask the user to run it. For any other "Vercel project" failure, relay the `|` lines and point the user to the README's "Troubleshooting" section.
