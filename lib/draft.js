import { config } from './config.js';
import { VOICE_SKILL } from './voiceSkill.js';
import { gatherResearch } from './research.js';
import { generateContent, textFromResponse } from './gemini.js';

const NOT_ENOUGH_PREFIX = 'NOT ENOUGH TO DRAFT:';
const SOURCES_LINE_RE = /\n?SOURCES USED:\s*([^\n]*)\s*$/i;

const SYSTEM_PROMPT = `You are drafting a LinkedIn post for Meera Pillai (Skinstinct), following the voice skill below exactly.

${VOICE_SKILL}

Hard rules for this specific use, on top of the skill above:
- You are producing a DRAFT ONLY. It will never be posted automatically — Meera reviews and posts it herself, manually, if she chooses to.
- Output ONLY the post text itself, followed by the required SOURCES USED line described below. No preamble ("Here's a draft:"), no title, no other meta-commentary, no quotation marks wrapping the whole thing, no markdown formatting.

Automatically gathered research candidates may be supplied below the fragment, numbered [1], [2], etc. Rules for using them:
- Use at most one, and only if it is genuinely specific, relevant, and checkable. Never force one in. Never fabricate or embellish beyond what a candidate actually states.
- Weave it into one supporting paragraph, never the opening hook, per the skill's own rule for a supplied news angle or data point.
- A specific, relevant fact from a candidate can satisfy the skill's Step 1 requirement for a concrete, checkable detail, even if Meera's own fragment is thin on its own — you do not need to reject a fragment for being thin if a candidate supplies that anchor.
- These are external, general industry/news facts, never the company's own data — do not present a candidate's number as if it were Skinstinct's own.
- If Meera also supplied her own explicit angle in the fragment, prioritize hers over the automatic candidates.
- Only fall back to the "NOT ENOUGH TO DRAFT:" case if neither Meera's fragment nor any candidate provides anything concrete and checkable to anchor a post. In that case, output exactly one short paragraph, prefixed literally with "NOT ENOUGH TO DRAFT:", that asks Meera one specific, answerable clarifying question that would unlock a draft (a number, a timeframe, a detail only she would know) — not a vague "need more detail" statement. Skip the SOURCES USED line entirely in this case.

Required last line of your output (every response except the "NOT ENOUGH TO DRAFT:" case): on its own line, after the draft, write exactly:
SOURCES USED: <comma-separated candidate numbers you drew a specific fact from, e.g. 2,4> — or SOURCES USED: none if you used none.
This line must never be discussed, explained, or referenced anywhere else in your output, and must be the literal final line.`;

function buildResearchBlock(candidates) {
  if (!candidates.length) return '';
  const lines = candidates.map((c, i) => {
    const source = c.source ? ` (${c.source})` : '';
    return `[${i + 1}] (Google News) "${c.title}"${source} — ${c.link}`;
  });
  return `\n\nAutomatically gathered research candidates (use at most one, only if genuinely relevant - see rules above):\n${lines.join('\n')}`;
}

function buildUserPrompt(transcript, angle, candidates) {
  let prompt = `Raw fragment from Meera:\n"""\n${transcript}\n"""`;
  if (angle) {
    prompt += `\n\nSupplied news angle / industry data point from Meera to weave into one supporting paragraph (never the opening hook):\n"""\n${angle}\n"""`;
  }
  prompt += buildResearchBlock(candidates);
  return prompt;
}

// Strips the "SOURCES USED: ..." line the model is required to append, and
// resolves it against the numbered candidate list so the caller can show
// Meera exactly which links (if any) fed into the draft she's reviewing.
function extractSources(rawText, candidates) {
  const match = rawText.match(SOURCES_LINE_RE);
  if (!match) {
    return { draft: rawText.trim(), usedSources: [], markerFound: false };
  }
  const draft = rawText.slice(0, match.index).trim();
  const indices = match[1]
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= candidates.length);
  const usedSources = indices.map((i) => candidates[i - 1]);
  return { draft, usedSources, markerFound: true };
}

async function draftWithGemini(transcript, angle, candidates) {
  const data = await generateContent(
    config.geminiDraftModel,
    {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: buildUserPrompt(transcript, angle, candidates) }] }],
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

async function draftWithClaude(transcript, angle, candidates) {
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
      messages: [{ role: 'user', content: buildUserPrompt(transcript, angle, candidates) }],
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

// Returns { draft, usedSources, candidatesFound, markerFound }.
// usedSources/candidatesFound/markerFound let the caller decide what (if
// anything) to show in a "research used" footer without guessing.
export async function generateDraft(transcript, angle) {
  const candidates = await gatherResearch(transcript, angle);

  const rawText =
    config.draftProvider === 'claude'
      ? await draftWithClaude(transcript, angle, candidates)
      : await draftWithGemini(transcript, angle, candidates);

  if (rawText.startsWith(NOT_ENOUGH_PREFIX)) {
    return { draft: rawText, usedSources: [], candidatesFound: candidates.length, markerFound: true };
  }

  const { draft, usedSources, markerFound } = extractSources(rawText, candidates);
  return { draft, usedSources, candidatesFound: candidates.length, markerFound };
}

export { NOT_ENOUGH_PREFIX };
