# tamlil-bot

[עברית](README.he.md)

A Telegram bot that transcribes your recordings. Send it a voice message, an audio or video file, or a share link, and it replies with a transcript split by speaker, Hebrew first, made by [Soniox](https://soniox.com).
With an OpenAI key it can also summarize the transcript.
You run your own copy on Vercel's free Hobby plan and pay Soniox only for the audio you transcribe.

What a transcript looks like in the chat (two speakers):

```text
Speaker 1:
Let's start with the budget.

Speaker 2:
Fine, I have three items.

⏱ 12:30 · 2 speakers
[ 📋 Summarize ]
```

Don't want to install anything? See [Tamlil](#dont-want-to-install-anything) at the end.

## What you need and what it costs

| You need | What for | Cost |
|---|---|---|
| A Telegram account | Creating the bot with @BotFather and using it | — |
| A Vercel account | Hosting the bot (Hobby plan) | Free. Personal or non-commercial use only, see [Vercel Hobby](#vercel-hobby-capacity-and-terms) |
| A Soniox account with credit | Transcription | $0.10 per hour of audio, pay as you go (as of 2026-11-22). New accounts get no free credit: add credit before the first recording |
| An OpenAI API key (optional) | Summaries | Default model `gpt-6-luna`: $0.10 per 1M input tokens, $0.50 per 1M output tokens (as of 2026-11-20) |
| Claude Code (optional) | The guided install | Needs a Claude subscription or a Claude Console account |

On your computer: [Node.js](https://nodejs.org) 22 or later and Git. The install adds the Vercel CLI if it is missing.

Example: 10 hours of recordings a month cost $1 at Soniox.

## Install with Claude Code

1. `git clone https://github.com/sagi770/tamlil-bot.git`
2. Open Claude Code in the `tamlil-bot` folder (in a terminal: `cd tamlil-bot`, then `claude`).
3. Say: **build me the app**

Claude Code checks your computer, asks whether you want summaries and which language the bot should speak, and opens `.env.local` for you to paste your keys into. You never paste a key into the chat. It then asks you to send `/start` to your new bot, deploys with `npm run setup` and checks the result with `npm run doctor`.

Your part: create the bot in @BotFather, get the keys, approve the Vercel login in your browser, send `/start`, and send a test voice message.

## Manual install

The same steps Claude Code follows.

**1. Check your tools**

```bash
git clone https://github.com/sagi770/tamlil-bot.git
cd tamlil-bot
node --version          # v22 or later
npm install
vercel --version        # 64.6.0 or later; if missing or older: npm i -g vercel@latest
vercel whoami           # if you are not logged in: vercel login
```

`vercel login` prints a link and a code. Open the link (on your computer or your phone), check the code, and approve.

On Windows PowerShell, if a command fails with "running scripts is disabled on this system", add `.cmd` to it (`npm.cmd install`, `vercel.cmd login`), or run the commands in Command Prompt or Git Bash.

**2. Get the keys**

- **Telegram bot token:** in Telegram, open @BotFather, send `/newbot`, choose a name and a username that ends in `bot`, and copy the token.
- **Soniox API key:** sign up at [console.soniox.com](https://console.soniox.com), open *My First Project* → *API Keys* and create a key. Add credit under [Billing](https://console.soniox.com/org/billing/overview/).
- **OpenAI API key** (only for summaries): create one at [platform.openai.com/api-keys](https://platform.openai.com/api-keys). The account needs API credit.

**3. Fill in `.env.local`**

```bash
cp .env.example .env.local
```

In Command Prompt (which has no `cp`): `copy .env.example .env.local`.

Open `.env.local` in a text editor and paste each value right after the `=`:

- `TELEGRAM_BOT_TOKEN=` and `SONIOX_API_KEY=` (required).
- For summaries, remove the `# ` at the start of the `OPENAI_API_KEY=` line and paste the key.
- For an English bot, change the line `# BOT_LANGUAGE=he` to `BOT_LANGUAGE=en`.

Leave the other lines as they are. `npm run setup` fills in the webhook secrets and your Telegram ID.

**4. Send `/start` to your new bot**

Open your bot in Telegram (the `t.me/...` link BotFather gave you) and send `/start`. It will not answer yet; that is expected. Setup reads this message to find your Telegram ID and lock the bot to you. Telegram keeps it for 24 hours, so do this shortly before step 5.

**5. Deploy**

```bash
npm run setup
```

Setup is safe to run again and never prints a key. It prints one line per step with ✓, ⚠ or ✗, and every problem gets a `→` line with the next step. A full successful run has 17 steps and ends like this (shortened):

```text
tamlil-bot setup

✓ Read .env.local
✓ Telegram bot token: @your_bot
✓ Soniox API key: accepted
✓ OpenAI summaries: key and model gpt-6-luna work
✓ Webhook secrets: generated TELEGRAM_WEBHOOK_SECRET and SONIOX_WEBHOOK_SECRET in .env.local
✓ Owner (who may use the bot): locked to @you (Telegram id 123456789), saved as ALLOWED_USER_IDS
…
✓ Ready message: sent to Telegram id 123456789

Summary
  …
  17 ok, 0 warnings, 0 failed

Your bot: https://t.me/your_bot
Access:   locked to one Telegram user: 123456789
```

What setup does, in order: checks the three keys (the OpenAI check is one short real summary), generates the two webhook secrets, locks the bot to you, checks the Vercel CLI and login, links the folder to a Vercel project named `tamlil-bot` (creating it if needed), saves the variables to Vercel production, deploys (usually one to three minutes), registers the Telegram webhook and command menu, checks that both endpoints (Telegram's and Soniox's) answer and refuse requests without the secret, transcribes Soniox's own sample file (it waits up to 3 minutes), and, when the bot is locked to you, sends you "The bot is ready. Send me a voice message to try it."

**6. Check and try it**

```bash
npm run doctor
```

When everything is fine, the output ends with `10 ok, 0 warnings, 0 failed`. Then send the bot a voice message.

Check that setup's "Owner" line names you. If the bot's token was used before, an older `/start` from someone else may be the one it found: put your own ID in `.env.local` as `ALLOWED_USER_IDS=<your ID>` and run `npm run setup` again (the bot shows your ID when it refuses you).

If setup could not lock the bot to you, it marks the "Owner" step with ⚠ and the bot stays open to everyone. What to do depends on that line:

- "the bot is already live, so setup cannot read your /start": send the bot `/id`, then run `npm run setup -- --owner-id=<your ID>`.
- "no /start message found": send `/start` to the bot and run `npm run setup` again. If that run already connected the bot to Telegram (✓ on "Telegram webhook"), the next run would only say "already live": use `/id` as above instead.

## Using the bot

- **Recordings:** send a voice message, an audio file, a video, a round video message, or an audio/video file sent as a document, up to 20 MB. The bot answers "⏳ Transcribing…" and then replies to your recording with the transcript.
- **Format:** one speaker gets plain text; several speakers get "Speaker 1:", "Speaker 2:" labels. The last line shows the length and the number of speakers (`⏱ 12:30 · 2 speakers`). A transcript longer than 3,500 characters arrives as a `.txt` file with timestamps, named `Transcript YYYY-MM-DD HH-MM.txt`.
- **Larger files:** send a share link instead. Google Drive and Dropbox links are converted to direct downloads, and any `https` link straight to an audio or video file is accepted too. Sharing must be set to "Anyone with the link". Soniox downloads the file itself.
- **Summary** (only when `OPENAI_API_KEY` is set): press "📋 Summarize" under a transcript, on a message or on a `.txt` file. To get the summary automatically, write "summary" in the caption of the recording, or in the same message as the link ("summarize", "tldr" and the Hebrew "סיכום" work too). The summary is plain text in the recording's language: the topic, the key points, and decisions and action items when there are any.
- **Commands:** `/start` (welcome), `/help` (how to use), `/id` (your Telegram ID).
- **Who can use it:** only the Telegram IDs in `ALLOWED_USER_IDS`. Anyone else gets "You don't have permission to use this bot." with their ID, which they can send you. To add people, see [Environment variables](#environment-variables).

## Environment variables

Your settings live in `.env.local`. `npm run setup` copies every variable that has a value to Vercel production and removes from Vercel the ones that are empty or missing in `.env.local`. To change a setting, edit `.env.local` and run `npm run setup` again. A change made only in the Vercel dashboard is undone by the next setup.

| Variable | | What it does |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | required | Bot token from @BotFather. |
| `SONIOX_API_KEY` | required | API key from the Soniox console. |
| `TELEGRAM_WEBHOOK_SECRET` | generated by setup | Authenticates requests from Telegram. |
| `SONIOX_WEBHOOK_SECRET` | generated by setup | Authenticates requests from Soniox. |
| `ALLOWED_USER_IDS` | strongly recommended; setup fills it | Comma-separated Telegram IDs allowed to use the bot. Empty: the bot works for everyone and warns. An entry that is not a numeric ID is ignored, but the bot stays locked (to the valid IDs, or to nobody), and setup and doctor fail and name the entry. |
| `ALLOW_ALL_USERS` | optional | `true` makes the bot public on purpose, with no warning. If `ALLOWED_USER_IDS` is also set, the lock wins. |
| `OPENAI_API_KEY` | optional | Turns on summaries. |
| `OPENAI_MODEL` | optional | Default `gpt-6-luna`. Another model must support Chat Completions with `reasoning_effort`. |
| `BOT_LANGUAGE` | optional | `he` (default) or `en`: the bot's messages and command menu. |
| `BOT_TIMEZONE` | optional | IANA time zone for `.txt` file names. Default `Asia/Jerusalem` for `he`, `UTC` for `en`; an invalid zone falls back to the default. |
| `LANGUAGE_HINTS` | optional | Soniox language hints, comma-separated. Default `he,en`. |
| `SONIOX_MODEL` | optional | Default `stt-async-v5`. |
| `SONIOX_CONTEXT` | optional | Names and terms that improve accuracy. Free text: wrap it in double quotes, because an unquoted ` #` starts a comment. |
| `PUBLIC_BASE_URL` | optional | A custom domain (`https://...`) for both webhooks. Otherwise setup registers the bot's Vercel production domain with Telegram, and Soniox's webhook goes to the same host Telegram calls. |

Example of adding a second person: `ALLOWED_USER_IDS=123456789,987654321`, then `npm run setup`.

## Limits

| Limit | Value |
|---|---|
| File sent in Telegram | Up to 20 MB (Telegram's limit for bots). Larger: send a share link. |
| Recording length | Up to 300 minutes (5 hours) per file (Soniox's limit). |
| Links | `https` only. Sharing must be "Anyone with the link". Drive folder links are rejected. YouTube links are not supported. |
| Chats | Private chats only. The bot ignores groups. |
| Summary | Transcripts up to 600,000 characters. A longer one is summarized from its first part, and the summary says so. |
| Formats | Whatever Soniox accepts: aac, aiff, amr, asf, flac, mp3, ogg, wav, webm, m4a, mp4. |

Tested live so far: voice messages, two speakers, long recordings as `.txt`, video, a file over 20 MB (refused with the link hint), Google Drive links (28 MB through the bot, 62 MB through the same pipeline run locally), summaries by button and by caption, a stranger being refused, and locking with `--owner-id`.

Not tested live yet: Dropbox links, links from other sites, Google Drive files over 100 MB (Drive may answer with a warning page; the bot then replies that the link does not lead to an audio or video file), round video messages, the automatic lock from the `/start` you send before the first setup, and `npm run dev`. The configuration variants (no OpenAI key, `ALLOW_ALL_USERS=true`) are covered by unit tests but not tested live.

## Privacy

- A file sent in Telegram passes only through the function's memory on its way to Soniox. A file sent as a link is downloaded by Soniox directly and never passes through Vercel.
- After the transcript is delivered, the transcription and the uploaded file are deleted at Soniox. If a delivery keeps failing, the job stays at Soniox until its automatic deletion after 30 days (`npm run doctor` reports such leftovers).
- The transcript then exists only in your Telegram chat.
- Logs contain only event names and a few plain fields such as error class names (`job_started`, `access_denied`, ...): no transcript text, no Telegram IDs or names, no keys.
- Telegram's file download link contains the bot token, so it is never logged and never sent to Soniox.
- Besides the audio, Soniox receives the chat ID and message IDs (in `client_reference_id`, so the result finds its way back) and the original file name.
- Both endpoints refuse any request without the right secret (HTTP 401).
- With summaries on, the transcript text is sent to OpenAI.
- An open bot lets anyone who finds it transcribe on your Soniox and OpenAI balance. That is why setup locks it to you.

## Vercel Hobby: capacity and terms

The Hobby plan includes, per month, 4 hours of Active CPU, 360 GB-hours of provisioned memory and 1,000,000 function invocations ([Vercel Hobby plan](https://vercel.com/docs/plans/hobby)).

Measured on the live bot: one transcription with a summary takes about 3 invocations, at most 0.5 s of CPU and at most about 17 s of instance time. That is room for thousands of transcriptions a month ([measurements](docs/DECISIONS.md#vercel-hobby-usage--measured-task-16-2026-11-22)). Files sent as links do not pass through Vercel at all.

Hobby is free and has no billing cycle. If you go over a limit, Vercel says that in most cases "you will have to wait until 30 days have passed before you can use the feature again."

Vercel's [Terms of Service](https://vercel.com/legal/terms) (section 4, Hobby Plan): "You shall only use the Services under a Hobby plan for your personal or non-commercial use." A bot for your own recordings fits. If you use it for a business, check Vercel's terms and [fair use guidelines](https://vercel.com/docs/limits/fair-use-guidelines), or ask Vercel.

## Troubleshooting

Start with:

```bash
npm run doctor
```

It changes nothing. It checks `.env.local`, the three keys (with summaries on, one short OpenAI call), the Telegram webhook including its last delivery error, that both endpoints answer and refuse requests without the secret, the Vercel link, the access mode and recordings left at Soniox. Every ✗ or ⚠ has a `→` line with the next step.

**The bot does not answer**

- Before the first `npm run setup` that is expected: nothing is connected yet.
- If doctor marks "Telegram webhook" with ✗, run `npm run setup`. If it shows Telegram's last delivery error, check the function logs in the Vercel dashboard (Logs; Hobby keeps them for 1 hour) and run `npm run setup` again.
- If the "Webhook endpoint check" of setup or doctor says the domain is behind Vercel Deployment Protection: Telegram and Soniox cannot call a protected URL. In the Vercel dashboard open the project → Settings → Deployment Protection and turn it off for production, or set `PUBLIC_BASE_URL` to a public domain. Then run `npm run setup`.
- In a group the bot stays silent on purpose: it only works in private chats.

**"The transcription credit has run out. Contact the bot owner to top it up."**

Your Soniox balance is empty: add credit in the [Soniox console](https://console.soniox.com/org/billing/overview/) (or turn on autopay there), then send the recording again. Soniox refuses the same way when a monthly budget cap you set in its console is reached, and the bot shows the same message: raise the cap. Setup's "Soniox test transcription" step catches this too.

**"I couldn't summarize. The transcript is safe, and you can try again with the "📋 Summarize" button."**

Run `npm run doctor`. Its "OpenAI summaries" line makes one real call and names the cause: a wrong key (HTTP 401), no credit (`insufficient_quota`), or a model your account cannot use (remove `OPENAI_MODEL` to use the default). To turn summaries off, delete `OPENAI_API_KEY` from `.env.local` and run `npm run setup`.

**Vercel CLI not logged in, missing or too old**

```bash
vercel login            # approve in the browser, then:
npm run setup
```

If `vercel` is missing or older than 64.6.0: `npm i -g vercel@latest`. On Windows PowerShell, see the note in [Manual install](#manual-install) about `npm.cmd` and `vercel.cmd`.

**The bot is open to everyone**

An open bot sends "⚠️ This bot is open to everyone" with your ID after `/start` and after every transcript. Lock it as the warning says: add the line `ALLOWED_USER_IDS=<your ID>` to `.env.local` and run `npm run setup`. Or send `/id` to the bot, then

```bash
npm run setup -- --owner-id=<your ID>
```

Do not only add it in the Vercel dashboard: the next setup removes it.

**Setup fails at "Vercel project"**

Read the lines under that step that start with `|`: they are the Vercel CLI's own message. If they mention choosing a team or scope, your account has several teams. List them, switch to the team the bot should live in (the slug is the name in the team's URL, `vercel.com/<slug>`), and run setup again:

```bash
vercel teams ls
vercel switch <team-slug>
npm run setup
```

`vercel switch` keeps the Vercel CLI on that team for later commands too. For any other message, fix what it says and run `npm run setup` again. Setup links the project itself: do not run `vercel link` by hand.

**"The link doesn't lead to an audio or video file."**

Set the file's sharing to "Anyone with the link", and send a link to the file, not to a folder. Very large Google Drive files sometimes answer with a warning page instead of the file; the bot then suggests Dropbox (Dropbox links have not been tested live yet).

**doctor reports "Recordings stored at Soniox"**

If nothing is being transcribed right now, these were left by deliveries that failed. Send those recordings again. Soniox deletes the leftovers after 30 days.

**"Transcription failed." or "Something went wrong."**

Send the recording again. If it keeps happening, run `npm run doctor` and check the function logs in the Vercel dashboard.

## Development

```bash
npm run check           # lint, typecheck and unit tests (no network)
npm run dev             # run the bot on this computer with long polling
```

`npm run dev` uses `.env.local`, needs no tunnel and waits for each transcription in the process. If the bot's token has a webhook (a deployed bot), it refuses to run, because it would disconnect that bot. Use a separate bot from @BotFather for development, or run `npm run dev -- --takeover`, which disconnects the deployed bot until you run `npm run setup` again. `npm run dev` has not been tested live yet.

CI runs `npm run check` on Node 22 and 24 for every push to `main` and every pull request. Project rules for contributors and coding agents are in [CLAUDE.md](CLAUDE.md).

## Don't want to install anything?

[Tamlil](https://tamlil.x-technologies.co.il) is Sagi Tawil's transcription product: nothing to install.

## License

[MIT](LICENSE) © 2026 Sagi Tawil
