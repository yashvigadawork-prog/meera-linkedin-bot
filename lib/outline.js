import { config } from './config.js';
import { generateContent, textFromResponse } from './gemini.js';

const OUTLINE_PROMPT = (fragment, angle) =>
  "You're proposing a quick plan for a LinkedIn post before it gets " +
  'written, based on this raw note from Meera (Skinstinct). This is a plan ' +
  'to approve, not the post itself - keep it short and skimmable.\n\n' +
  `Note:\n"""\n${fragment}\n"""` +
  (angle ? `\n\nSupplied angle:\n"""\n${angle}\n"""` : '') +
  '\n\nOutput exactly this structure, nothing else:\n\n' +
  'Format: recommend either "Short (~150-250 words, one tight point)" or ' +
  '"Long (~300-600 words, fuller argument)" based on how much the note ' +
  'supports, with one sentence why.\n\n' +
  'Outline:\n' +
  '- Hook: [the opening approach, in one line]\n' +
  '- [2 to 4 more bullets, each one line, describing what each part covers]\n' +
  '- Close: [how it ends, in one line]\n\n' +
  'Keep every line short - this is a plan, not prose.';

// Proposed before drafting starts - never throws upward as "no plan
// available," since this step is required by the flow, not optional like
// research; a failure here should surface as a real error.
export async function proposeOutline(fragment, angle) {
  const data = await generateContent(
    config.geminiDraftModel,
    {
      contents: [{ role: 'user', parts: [{ text: OUTLINE_PROMPT(fragment, angle) }] }],
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 500,
        thinkingConfig: { thinkingBudget: 0 },
      },
    },
    { timeoutMs: 15000, retries: 2 }
  );
  const text = textFromResponse(data);
  if (!text) {
    throw new Error('Gemini returned an empty outline.');
  }
  return text;
}
