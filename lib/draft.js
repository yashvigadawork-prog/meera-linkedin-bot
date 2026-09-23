import { config } from './config.js';
import { VOICE_SKILL } from './voiceSkill.js';

const SYSTEM_PROMPT = `You are drafting a LinkedIn post for Meera Pillai (Skinstinct), following the voice skill below exactly.

${VOICE_SKILL}

Hard rules for this specific use, on top of the skill above:
- You are producing a DRAFT ONLY. It will never be posted automatically — Meera reviews and posts it herself, manually, if she chooses to.
- Output ONLY the post text itself. No preamble ("Here's a draft:"), no title, no explanation, no meta-commentary, no quotation marks wrapping the whole thing, no markdown formatting.
- If the input fragment has no specific, checkable detail behind it (per Step 1 of the skill), do not force a post. Instead output exactly one short paragraph, prefixed literally with "NOT ENOUGH TO DRAFT:", explaining what concrete detail is missing and what she could add.`;

function buildUserPrompt(transcript, newsAngle) {
  let prompt = `Raw fragment from Meera:\n"""\n${transcript}\n"""`;
  if (newsAngle) {
    prompt += `\n\nSupplied news angle / industry data point to weave into one supporting paragraph (never the opening hook):\n"""\n${newsAngle}\n"""`;
  }
  return prompt;
}

async function draftWithGemini(transcript, newsAngle) {
  const apiKey = config.geminiApiKey();
  const model = config.geminiDraftModel;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: buildUserPrompt(transcript, newsAngle) }] }],
      generationConfig: { temperature: 0.8 },
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Gemini drafting failed: ${data.error?.message || res.status}`);
  }
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim();
  if (!text) {
    throw new Error('Gemini returned an empty draft.');
  }
  return text;
}

async function draftWithClaude(transcript, newsAngle) {
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
      messages: [{ role: 'user', content: buildUserPrompt(transcript, newsAngle) }],
    }),
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

export async function generateDraft(transcript, newsAngle) {
  if (config.draftProvider === 'claude') {
    return draftWithClaude(transcript, newsAngle);
  }
  return draftWithGemini(transcript, newsAngle);
}
