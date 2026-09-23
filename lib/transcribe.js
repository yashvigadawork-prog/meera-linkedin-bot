import { config } from './config.js';

const TRANSCRIBE_PROMPT =
  'Transcribe this audio verbatim, in the original language. ' +
  'Output only the raw transcript text. No commentary, no timestamps, ' +
  'no speaker labels, no summary.';

// Gemini is used for transcription regardless of DRAFT_PROVIDER because it
// accepts audio natively — Telegram voice notes go straight in as inline
// data, no separate speech-to-text service needed.
export async function transcribeAudio(base64Audio, mimeType) {
  const apiKey = config.geminiApiKey();
  const model = config.geminiTranscribeModel;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
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
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Gemini transcription failed: ${data.error?.message || res.status}`);
  }
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('').trim();
  if (!text) {
    throw new Error('Gemini returned an empty transcript.');
  }
  return text;
}
