import { config } from './config.js';

const RETRYABLE_STATUSES = new Set([503, 429]);
const DEFAULT_TIMEOUT_MS = 25000;
const DEFAULT_RETRIES = 1;
const MAX_BACKOFF_MS = 8000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Exponential backoff (1.5s, 3s, 6s, capped at 8s) - Google's own error
// message for this calls it a "temporary spike," so a few widening waits
// buy real odds of landing after it passes, observed directly in
// production: a single retry wasn't enough for a real transcription call.
function backoffMs(attempt) {
  return Math.min(1500 * 2 ** attempt, MAX_BACKOFF_MS);
}

// Shared Gemini generateContent caller.
//
// Two failure modes matter here, and they get different handling:
// - A slow/hung connection (observed directly while building this - a
//   request can just sit with no response and no error) - guarded with a
//   hard AbortSignal timeout so a stuck call fails fast instead of hanging
//   the whole serverless function until the platform kills it.
// - A fast 503/429 (also observed directly - transient capacity errors)
//   - retried a small, bounded number of times with backoff.
//
// timeoutMs/retries are tunable per call site so a best-effort step (like
// search-query extraction) can fail fast without eating into the budget
// the actual draft generation needs.
export async function generateContent(model, body, { timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES } = {}) {
  const apiKey = config.geminiApiKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const maxAttempts = retries + 1;

  let lastError;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // Network error or timeout - fail fast, no retry (retrying a hang
      // rarely helps and would just double the wait).
      throw new Error(`Gemini request failed (network/timeout): ${err.message}`);
    }

    const data = await res.json();
    if (res.ok) return data;

    lastError = new Error(`Gemini request failed: ${data.error?.message || res.status}`);
    if (!RETRYABLE_STATUSES.has(res.status) || attempt === maxAttempts - 1) {
      throw lastError;
    }
    await sleep(backoffMs(attempt));
  }
  throw lastError;
}

// This model returns its internal reasoning as parts with `thought: true`
// mixed into the same array as the real answer - observed directly (a
// scoring call returned literal chain-of-thought text like "Let's refine
// the reason to be punchy..." instead of the JSON). Every caller needs the
// final answer only, so this filters thought parts out in one place rather
// than trusting each call site to remember to.
export function textFromResponse(data) {
  return (data.candidates?.[0]?.content?.parts || [])
    .filter((p) => !p.thought)
    .map((p) => p.text || '')
    .join('')
    .trim();
}
