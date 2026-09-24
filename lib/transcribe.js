import { config } from './config.js';
import { generateContent, textFromResponse } from './gemini.js';

const TRANSCRIBE_PROMPT =
  'Transcribe this audio verbatim, in the original language. ' +
  'Output only the raw transcript text. No commentary, no timestamps, ' +
  'no speaker labels, no summary.';

// Gemini is used for transcription regardless of DRAFT_PROVIDER because it
// accepts audio natively — Telegram voice notes go straight in as inline
// data, no separate speech-to-text service needed.
export async function transcribeAudio(base64Audio, mimeType) {
  const data = await generateContent(
    config.geminiTranscribeModel,
    {
      contents: [
        {
          role: 'user',
          parts: [
            { text: TRANSCRIBE_PROMPT },
            { inlineData: { mimeType, data: base64Audio } },
          ],
        },
      ],
      generationConfig: { temperature: 0.1 },
    },
    { timeoutMs: 30000, retries: 1 }
  );

  const text = textFromResponse(data);
  if (!text) {
    throw new Error('Gemini returned an empty transcript.');
  }
  return text;
}
