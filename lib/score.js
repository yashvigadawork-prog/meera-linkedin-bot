import { config } from './config.js';
import { generateContent, textFromResponse } from './gemini.js';

export const SCORE_THRESHOLD = 6;

const SCORE_PROMPT = (fragment) => `You are the gatekeeper for a founder's LinkedIn drafting pipeline. Every raw Telegram note she sends reaches you before anything gets drafted from it - your job is to stop the ones that don't deserve a draft.

Score this note from 0 to 10 on how usable it is as the seed for a real LinkedIn post. This is not a grammar or completeness check - it's about substance: does the note contain a genuine idea, story, incident, number, or opinion worth developing, or is it just noise?

Score 0-3 (reject) for:
- A logistics or task reminder ("call the supplier tomorrow", "don't forget the invoice", "follow up with the lab")
- An abandoned half-thought with no actual point ("so today was kind of a lot, anyway...")
- Pure mood or venting with nothing underneath it to build a post from

Score 6-10 (usable) for:
- A specific incident, conversation, or scene she could narrate
- A number, data point, or concrete detail
- A genuine opinion, argument, or insight with a point to make

Score 4-5 for something genuinely borderline - has a kernel of something but is thin.

Note:
"""
${fragment}
"""

Respond with strict JSON only, no markdown code fences, no other text:
{"score": <integer 0-10>, "reason": "<one line, under 15 words, explaining the score>"}`;

function parseScoreResponse(text) {
  const cleaned = text.replace(/```json|```/gi, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`Could not parse score response: ${text}`);
    parsed = JSON.parse(match[0]);
  }
  const score = Number(parsed.score);
  if (!Number.isFinite(score) || score < 0 || score > 10) {
    throw new Error(`Invalid score in response: ${text}`);
  }
  return { score: Math.round(score), reason: String(parsed.reason || '').trim() };
}

// Gate before drafting even starts. Never silently passes on failure - if
// scoring itself breaks, that's surfaced as an error rather than defaulting
// everything through (unlike research, this isn't optional).
export async function scoreNote(fragment) {
  const data = await generateContent(
    config.geminiDraftModel,
    {
      contents: [{ role: 'user', parts: [{ text: SCORE_PROMPT(fragment) }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 300,
        thinkingConfig: { thinkingBudget: 0 },
      },
    },
    { timeoutMs: 15000, retries: 2 }
  );
  return parseScoreResponse(textFromResponse(data));
}
