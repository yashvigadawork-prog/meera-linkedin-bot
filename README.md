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
4. Gemini turns the fragment into 1-2 search queries, then the bot pulls
   candidate supporting facts from Google News
   ([`lib/research.js`](lib/research.js)) — so Meera doesn't have to supply
   all the research herself. (General web search isn't part of this: Google
   deprecated whole-web search for newly created Custom Search API engines,
   so that option was dropped rather than built against a dead end. See
   [Adding general web search later](#adding-general-web-search-later) if
   you want to revisit it with a different provider.)
5. The transcript, those research candidates, and (if she typed one) her own
   supplied angle are all sent to a drafting model — Gemini by default, or
   Claude if you set `DRAFT_PROVIDER=claude` — along with
   [`lib/voiceSkill.js`](lib/voiceSkill.js), which is Meera's voice-skill
   instructions verbatim, as the system prompt. The model is told to use a
   research candidate only if it's genuinely specific and relevant — never
   to force one in or fabricate a number.
6. The draft is sent straight back to the same channel, clearly labeled as
   a draft, with a footer listing any research links it actually drew on
   (so she can verify a figure before posting). Nothing is published or
   scheduled.

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

- `api/webhook.js` — Telegram webhook handler (the entry point)
- `lib/config.js` — environment variable defaults
- `lib/telegram.js` — Telegram API calls (send message, download file)
- `lib/gemini.js` — shared Gemini caller (timeouts + retry on 503/429)
- `lib/transcribe.js` — Gemini audio transcription
- `lib/research.js` — Google News RSS research
- `lib/draft.js` — drafting call (Gemini or Claude) + system prompt
- `lib/voiceSkill.js` — Meera's voice-skill instructions (verbatim)
- `scripts/set-webhook.js` — one-off script to point Telegram at your deploy
- `scripts/delete-webhook.js` — one-off script to remove the webhook

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

No key is needed for the automatic research step — it uses Google News RSS,
which is free and keyless.

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

If a value starts with `-` (some Telegram chat ids do), `vercel env add`
can misparse it as a flag — pipe it in via stdin instead of typing it at
the prompt, e.g. `printf '%s' "$ALLOWED_CHAT_ID" | vercel env add ALLOWED_CHAT_ID production`.

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
- **Research is automatic, every time.** The bot turns the fragment into 1-2
  search queries, checks Google News, and may weave in one genuinely
  relevant, specific, checkable fact from what it finds — never forced,
  never fabricated. If nothing relevant turns up, it drafts from the
  fragment alone, same as before.
- **A relevant research fact can also unlock a thin fragment.** Meera no
  longer has to supply every number herself — if her own note is short on
  specifics but the research turns up something concrete and on-topic, the
  bot can use that as the anchor instead of asking her for more.
- **Optional manual angle:** add a line starting with `Angle:` (in a text
  message, or in the caption of an audio file upload — not a voice note,
  which Telegram doesn't let you caption) to hand the drafting model a
  specific angle or data point yourself. When supplied, her own angle takes
  priority over anything the automatic research finds. For example:

  ```
  Just found out our return rate on the vitamin C serum dropped after we
  changed the packaging insert.

  Angle: a recent report found 40% of skincare returns cite "didn't match
  expectations" rather than a defect.
  ```

- **"Research used" footer:** when the draft actually drew on something the
  bot found, the Telegram reply ends with a short footer listing those
  links, so Meera can verify a figure before posting. This footer never
  makes it into the LinkedIn post text itself.
- **If a fragment is still too thin to draft**, even after research (no
  concrete number, incident, or detail — see Step 1 of the voice skill), the
  bot doesn't just say "need more detail" — it replies with one specific,
  answerable clarifying question (e.g. a number or timeframe only Meera
  would know). There's no conversation memory between messages, so she
  answers it by sending a fresh note that includes the answer, rather than
  replying in a thread.
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

## Adding general web search later

Google Custom Search API can no longer be configured to search the whole
web for newly created search engines (Google deprecated that option) — it
can only search specific domains you list, up to 50. That's why research
here is Google News only for now. If you want general web search added
back, options worth considering:

- **Scope Google Custom Search to a curated list** of trusted
  skincare/dermatology/beauty-industry/regulatory domains instead of the
  whole web — narrower, but arguably higher-quality sources anyway.
- **A different search API** that still does real whole-web search, e.g.
  Bing Web Search (via Azure), SerpApi, or Brave Search — more setup and
  likely a paid signup, but keeps genuine open-web reach.

Either would slot into [`lib/research.js`](lib/research.js) alongside the
existing Google News function.
