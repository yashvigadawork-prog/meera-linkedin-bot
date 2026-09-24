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
   directly from audio (no separate speech-to-text service needed). The note
   is saved to Supabase (if configured) as soon as there's a transcript.
4. Gemini **scores the note 0-10** on whether it has real substance —
   a logistics reminder or an abandoned half-thought scores low and the
   pipeline stops there, sending a short message explaining why instead of
   forcing a shallow draft ([`lib/score.js`](lib/score.js)).
5. If it passes, Gemini pulls 3-5 keywords into a search phrase, and the bot
   fetches the single top matching Google News result — headline, source,
   date, link ([`lib/research.js`](lib/research.js)). (General web search
   isn't part of this: Google deprecated whole-web search for newly created
   Custom Search API engines, so that option was dropped rather than built
   against a dead end. See
   [Adding general web search later](#adding-general-web-search-later) if
   you want to revisit it with a different provider.)
6. The transcript, that news item (if any), and (if she typed one) her own
   supplied angle are all sent to a drafting model — Gemini by default, or
   Claude if you set `DRAFT_PROVIDER=claude` — along with
   [`lib/voiceSkill.js`](lib/voiceSkill.js), which is Meera's voice-skill
   instructions verbatim, as the system prompt. The model is told to use the
   news item only if it's genuinely relevant and fits naturally — never to
   force it in or fabricate a claim.
7. The draft is sent straight back to the same channel, clearly labeled as
   a draft. If it used the news item, a verify-flag block (headline,
   publication, date, link, and an explicit warning that she's the author of
   record for that claim) is appended, built from the known fields rather
   than left to the model to reproduce. Nothing is published or scheduled.
8. The draft is saved to Supabase with status `pending` (if configured).
   Replying **APPROVE** or **REJECT** to that message updates its status —
   rejected notes and drafts are kept, not deleted, so they show what needs
   improving.

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
- `lib/score.js` — pre-draft usability scoring (0-10 gate)
- `lib/research.js` — Google News single-item research
- `lib/draft.js` — drafting call (Gemini or Claude) + system prompt
- `lib/voiceSkill.js` — Meera's voice-skill instructions (verbatim)
- `lib/supabase.js` — memory layer (notes/drafts/voice_skill persistence)
- `supabase/schema.sql` — table definitions + seeded voice-skill row
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

### 3. Set up the memory layer (Supabase)

Optional, but needed for notes/drafts to be saved and for APPROVE/REJECT
replies to work. Without it, the bot behaves exactly the same, it just
doesn't remember anything between requests.

1. Create a project at [supabase.com](https://supabase.com) (free tier is
   plenty for this volume).
2. In the Supabase dashboard, go to **SQL Editor → New query**, paste in the
   contents of [`supabase/schema.sql`](supabase/schema.sql), and run it. This
   creates the three tables (`notes`, `drafts`, `voice_skill`) and seeds
   `voice_skill` with the current content of `lib/voiceSkill.js`.
3. From **Project Settings → API**, copy:
   - **Project URL** → `SUPABASE_URL`
   - **service_role key** (not the `anon` key — this is a server-only secret
     that bypasses row-level security, which is fine since it's only ever
     used from this backend, never exposed to a client) → `SUPABASE_SERVICE_ROLE_KEY`

### 4. Deploy to Vercel

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
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_ROLE_KEY
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

### 5. Point Telegram at your deployment

```bash
TELEGRAM_BOT_TOKEN=your-token \
TELEGRAM_WEBHOOK_SECRET=your-secret \
node scripts/set-webhook.js https://your-project.vercel.app
```

(Use the same values you set in Vercel's env vars.) Re-run this any time
your deployment URL changes.

### 6. Try it

Post a voice note into the channel. You should get a draft back within a
few seconds, clearly labeled as a draft. Reply APPROVE or REJECT to it, and
(if Supabase is set up) check the `drafts` table — the status should update.

## Usage notes

- **Voice notes and typed fragments both work.** Anything sent as text or
  as a voice message is treated as raw material for a draft.
- **Every note is scored before drafting.** Gemini scores it 0-10 on
  substance — a logistics reminder ("call the packaging vendor tomorrow")
  or an abandoned half-thought scores low (the threshold is 6) and the
  pipeline stops, sending back the score and a one-line reason instead of
  forcing a draft. A note with a real incident, number, or opinion passes
  through to drafting.
- **News research is automatic, every time a note passes scoring.** The bot
  pulls one candidate news item from Google News and tells the model to use
  it only if it's genuinely relevant and fits naturally — never forced,
  never fabricated. If nothing relevant turns up, it drafts from the
  fragment alone.
- **Optional manual angle:** add a line starting with `Angle:` (in a text
  message, or in the caption of an audio file upload — not a voice note,
  which Telegram doesn't let you caption) to hand the drafting model a
  specific angle or data point yourself. When supplied, her own angle takes
  priority over whatever news item the bot found automatically. For example:

  ```
  Just found out our return rate on the vitamin C serum dropped after we
  changed the packaging insert.

  Angle: a recent report found 40% of skincare returns cite "didn't match
  expectations" rather than a defect.
  ```

- **Verify-flag block:** when the draft actually used the news item, the
  Telegram reply ends with a fixed-format block — headline, publication,
  date, link, and an explicit warning that she's the author of record for
  that claim — so she can check it before posting. This block never makes
  it into the LinkedIn post text itself, and it's built from the known
  fields in code, not left to the model to reproduce verbatim.
- **If a fragment is still too thin to draft**, even after passing scoring
  and with no relevant news to anchor it (rare, since scoring already
  filters most of these out), the bot replies with one specific, answerable
  clarifying question (e.g. a number or timeframe only Meera would know)
  instead of a generic "need more detail." There's no conversation memory
  between messages for this case, so she answers it by sending a fresh note
  that includes the answer, rather than replying in a thread.
- **Reply APPROVE or REJECT to any draft** to record a decision (requires
  Supabase to be configured — see Setup step 3). Rejected notes and drafts
  are kept, not deleted, so they show what needs improving.
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
