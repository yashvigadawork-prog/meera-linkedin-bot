# Meera LinkedIn Draft Bot

A Telegram bot that turns Meera's voice notes and text fragments into
draft LinkedIn posts in her voice, and sends the draft back to her in the
same chat.

**Hard boundary: this bot never posts or schedules anything.** There is no
LinkedIn API integration anywhere in this codebase — it cannot publish even
if you wanted it to. Every draft goes back to Telegram for Meera to review
and post herself, manually, whenever she chooses.

## How it works

1. Meera posts a voice note (or types a fragment) into her personal
   Telegram channel.
2. Telegram calls this project's webhook (`/api/webhook`), hosted on Vercel.
3. If it's a voice note, [Gemini](https://ai.google.dev) transcribes it
   directly from audio (no separate speech-to-text service needed).
4. The transcript (or typed text) is sent to a drafting model — Gemini by
   default, or Claude if you set `DRAFT_PROVIDER=claude` — along with
   [`lib/voiceSkill.js`](lib/voiceSkill.js), which is Meera's voice-skill
   instructions verbatim, as the system prompt.
5. The draft is sent straight back to the same channel, clearly
   labeled as a draft. Nothing is published or scheduled.

Only posts from `ALLOWED_CHAT_ID` (Meera's channel) are processed — anyone
else's messages are silently ignored, so a stranger can't burn your API
budget or receive drafts.

This is built for a **channel** workflow (Telegram delivers channel posts
as `channel_post` updates, distinct from a normal 1:1 `message`), which is
what a private "notes to self" channel is. If you instead want Meera
messaging the bot directly in a 1:1 chat, that works too — the webhook
handles both update shapes — just use her personal chat id instead of a
channel id for `ALLOWED_CHAT_ID`.

## Project layout

```
api/webhook.js       Telegram webhook handler (the entry point)
lib/config.js         Environment variable / defaults
lib/telegram.js        Telegram API calls (send message, download file)
lib/transcribe.js      Gemini audio transcription
lib/draft.js           Drafting call (Gemini or Claude) + system prompt
lib/voiceSkill.js       Meera's voice-skill instructions (verbatim)
scripts/set-webhook.js    One-off script to point Telegram at your deploy
scripts/delete-webhook.js One-off script to remove the webhook
```

## Setup

### 1. Create the Telegram bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram, send `/newbot`,
   and follow the prompts. You'll get a bot token that looks like
   `123456789:AAExampleTokenAbcDefGhiJklMnoPqrStuVwx`.
2. Add the bot to Meera's channel **as an administrator**, with at least
   the "Post Messages" permission. This is required both ways: a bot can't
   see channel posts at all unless it's an admin, and it can't send the
   draft back unless it can post.
3. Find the channel's chat id: post anything in the channel, then open
   `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser and
   read `result[0].channel_post.chat.id` from the JSON — it'll be a large
   negative number like `-1001234567890`. That's `ALLOWED_CHAT_ID`.

   (If you're doing a 1:1 bot chat instead of a channel, message the bot
   directly and read `result[0].message.chat.id` instead.)

### 2. Get API keys

- **Gemini** (required — used for transcription, and for drafting unless
  you switch providers): [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
- **Claude** (optional — only needed if you set `DRAFT_PROVIDER=claude`):
  [console.anthropic.com](https://console.anthropic.com)

### 3. Deploy to Vercel

```bash
cd meera-linkedin-bot
npx vercel
```

Follow the prompts to link/create a project. Then set the environment
variables (Project Settings → Environment Variables on vercel.com, or via
CLI):

```bash
vercel env add TELEGRAM_BOT_TOKEN
vercel env add TELEGRAM_WEBHOOK_SECRET
vercel env add ALLOWED_CHAT_ID
vercel env add GEMINI_API_KEY
# optional:
vercel env add ANTHROPIC_API_KEY
vercel env add DRAFT_PROVIDER
```

See [`.env.example`](.env.example) for what each variable does.
`TELEGRAM_WEBHOOK_SECRET` can be any long random string you make up — it's
just used to verify incoming requests really came from Telegram.

Deploy to production:

```bash
vercel --prod
```

### 4. Point Telegram at your deployment

```bash
TELEGRAM_BOT_TOKEN=your-token \
TELEGRAM_WEBHOOK_SECRET=your-secret \
node scripts/set-webhook.js https://your-project.vercel.app
```

(Use the same values you set in Vercel's env vars.) Re-run this any time
your deployment URL changes.

### 5. Try it

Post a voice note into the channel. You should get a draft back within a
few seconds, clearly labeled as a draft.

## Usage notes

- **Voice notes and typed fragments both work.** Anything sent as text or
  as a voice message is treated as raw material for a draft.
- **Optional news angle:** add a line starting with `Angle:` (in a text
  message, or in the caption of an audio file upload — not a voice note,
  which Telegram doesn't let you caption) to hand the drafting model a news
  angle or data point to weave into one supporting paragraph. For example:

  ```
  Just found out our return rate on the vitamin C serum dropped after we
  changed the packaging insert.

  Angle: a recent report found 40% of skincare returns cite "didn't match
  expectations" rather than a defect.
  ```

- **If a fragment is too thin to draft** (no concrete number, incident, or
  detail — see Step 1 of the voice skill), the bot replies explaining what's
  missing instead of forcing a shallow post.
- `/start` in the chat gets a short usage reminder.

## Local development

There's no local dev server needed for normal use — this is two files of
serverless functions. To test end-to-end locally you'd need `vercel dev`
plus a tunnel (e.g. ngrok) so Telegram can reach your machine; for most
iteration, editing and redeploying to a Vercel preview URL is simpler.

## Switching the drafting model

Set `DRAFT_PROVIDER=gemini` (default) or `DRAFT_PROVIDER=claude` in your
Vercel env vars. Transcription always uses Gemini either way, since Claude
doesn't currently accept audio input directly.
