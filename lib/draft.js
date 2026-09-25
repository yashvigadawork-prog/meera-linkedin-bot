import { config } from './config.js';
import { VOICE_SKILL } from './voiceSkill.js';
import { findNewsAngle } from './research.js';
import { generateContent, textFromResponse } from './gemini.js';

const NOT_ENOUGH_PREFIX = 'NOT ENOUGH TO DRAFT:';
const NEWS_LINE_RE = /\n?NEWS USED:\s*(yes|no)\s*$/i;

const SYSTEM_PROMPT = `You are drafting a LinkedIn post for Meera Pillai (Skinstinct), following the voice skill below exactly.

${VOICE_SKILL}

Hard rules for this specific use, on top of the skill above:
- You are producing a DRAFT ONLY. It will never be posted automatically — Meera reviews and posts it herself, manually, if she chooses to.
- This note already passed a separate usability check before reaching you, so it should have real substance to work with. Only use the "NOT ENOUGH TO DRAFT:" fallback below if, despite that, you genuinely cannot find anything concrete and checkable to anchor a post.
- Output ONLY the post text itself, followed by the required NEWS USED line described below when a news item was supplied. No preamble ("Here's a draft:"), no title, no other meta-commentary, no quotation marks wrapping the whole thing, no markdown formatting.
- If Meera supplied her own explicit angle in the fragment, that takes priority over any automatically found news item below.
- A proposed format and outline were already shown to Meera before you were called, and her response to it may be supplied below - if so, follow her length choice (short: roughly 150-250 words, or long: the skill's normal 300-600 word target) and fold in anything else she asked for. If she just approved the plan without specifics, use the plan's own recommendation.
- If nothing usable exists at all, output exactly one short paragraph, prefixed literally with "NOT ENOUGH TO DRAFT:", that asks Meera one specific, answerable clarifying question that would unlock a draft (a number, a timeframe, a detail only she would know) — not a vague "need more detail" statement. Skip the NEWS USED line entirely in this case.`;

const NEWS_INSTRUCTION =
  'If this news item is genuinely relevant, use it to make the post timely. ' +
  "If it doesn't fit naturally, ignore it. Never fabricate or embellish " +
  "beyond what it actually states, and never present it as Skinstinct's " +
  'own data — it is an external, general industry/news fact.';

function buildNewsBlock(newsItem) {
  if (!newsItem) return '';
  const summaryLine = newsItem.summary ? `\nSummary: ${newsItem.summary}` : '';
  return (
    '\n\nA news item was automatically found for this note:\n' +
    `Headline: ${newsItem.headline}\n` +
    `Source: ${newsItem.source}\n` +
    `Date: ${newsItem.date}${summaryLine}\n\n` +
    `${NEWS_INSTRUCTION}\n\n` +
    'Required last line of your output: on its own line, after the draft, ' +
    'write exactly "NEWS USED: yes" if you used this item, or ' +
    '"NEWS USED: no" if you ignored it. This line must never be discussed ' +
    'anywhere else in your output, and must be the literal final line.'
  );
}

function buildUserPrompt(transcript, angle, newsItem, outlineFeedback) {
  let prompt = `Raw fragment from Meera:\n"""\n${transcript}\n"""`;
  if (angle) {
    prompt += `\n\nSupplied news angle / industry data point from Meera to weave into one supporting paragraph (never the opening hook):\n"""\n${angle}\n"""`;
  }
  if (outlineFeedback) {
    prompt += `\n\nMeera's response to the proposed format/outline (follow her length choice and any changes she asked for):\n"""\n${outlineFeedback}\n"""`;
  }
  prompt += buildNewsBlock(newsItem);
  return prompt;
}

// Exact template required by spec - built in code, never left to the model
// to reproduce verbatim, so the warning always renders correctly.
export function buildVerifyFlagBlock(newsItem) {
  return [
    '─────────────────────────────────',
    `NEWS SOURCE: ${newsItem.headline}`,
    `FROM: ${newsItem.source} · ${newsItem.date}`,
    `LINK: ${newsItem.link}`,
    '⚠ Check this before publishing — you are the author of this claim',
    '─────────────────────────────────',
  ].join('\n');
}

// Strips the "NEWS USED: yes|no" line the model is required to append when
// a news item was supplied, and reports whether it was actually used.
function extractNewsUsage(rawText, newsItem) {
  if (!newsItem) return { draft: rawText.trim(), newsUsed: false };
  const match = rawText.match(NEWS_LINE_RE);
  if (!match) return { draft: rawText.trim(), newsUsed: false };
  const draft = rawText.slice(0, match.index).trim();
  return { draft, newsUsed: match[1].toLowerCase() === 'yes' };
}

async function draftWithGemini(transcript, angle, newsItem, outlineFeedback) {
  const data = await generateContent(
    config.geminiDraftModel,
    {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: buildUserPrompt(transcript, angle, newsItem, outlineFeedback) }] }],
      generationConfig: { temperature: 0.8 },
    },
    { timeoutMs: 35000, retries: 3 }
  );
  const text = textFromResponse(data);
  if (!text) {
    throw new Error('Gemini returned an empty draft.');
  }
  return text;
}

async function draftWithClaude(transcript, angle, newsItem, outlineFeedback) {
  const apiKey = config.anthropicApiKey();
  const model = config.claudeDraftModel;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1500,
      temperature: 0.8,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(transcript, angle, newsItem, outlineFeedback) }],
    }),
    signal: AbortSignal.timeout(35000),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Claude drafting failed: ${data.error?.message || res.status}`);
  }
  const text = data.content?.map((block) => block.text || '').join('').trim();
  if (!text) {
    throw new Error('Claude returned an empty draft.');
  }
  return text;
}

// Returns { draft, newsItem, newsUsed }. newsItem is the candidate found
// (or null); newsUsed says whether the model actually wove it in - the
// caller appends the verify-flag block only when true. outlineFeedback is
// Meera's reply to the proposed format/outline (optional).
export async function generateDraft(transcript, angle, outlineFeedback) {
  const newsItem = await findNewsAngle(transcript, angle);

  const rawText =
    config.draftProvider === 'claude'
      ? await draftWithClaude(transcript, angle, newsItem, outlineFeedback)
      : await draftWithGemini(transcript, angle, newsItem, outlineFeedback);

  if (rawText.startsWith(NOT_ENOUGH_PREFIX)) {
    return { draft: rawText, newsItem, newsUsed: false };
  }

  const { draft, newsUsed } = extractNewsUsage(rawText, newsItem);
  return { draft, newsItem, newsUsed };
}

export { NOT_ENOUGH_PREFIX };
