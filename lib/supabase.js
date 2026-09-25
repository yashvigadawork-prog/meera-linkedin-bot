import { config } from './config.js';

// Plain PostgREST calls via fetch - no SDK dependency, consistent with the
// rest of this project. The service role key is used because writes happen
// server-side only, from a trusted context; it must never be exposed to a
// client, but there is no client here.

function isConfigured() {
  return Boolean(config.supabaseUrl && config.supabaseServiceKey);
}

function restRoot() {
  return `${config.supabaseUrl.replace(/\/$/, '')}/rest/v1`;
}

async function request(method, path, body, extraHeaders = {}) {
  const res = await fetch(`${restRoot()}${path}`, {
    method,
    headers: {
      apikey: config.supabaseServiceKey,
      authorization: `Bearer ${config.supabaseServiceKey}`,
      'content-type': 'application/json',
      ...extraHeaders,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase ${method} ${path} failed: ${res.status} ${text}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function insertNote(note) {
  if (!isConfigured()) return null;
  const rows = await request('POST', '/notes', note, { prefer: 'return=representation' });
  return rows?.[0] || null;
}

export async function updateNote(id, fields) {
  if (!isConfigured() || !id) return;
  await request('PATCH', `/notes?id=eq.${id}`, fields, { prefer: 'return=minimal' });
}

export async function insertDraft(draft) {
  if (!isConfigured()) return null;
  const rows = await request('POST', '/drafts', draft, { prefer: 'return=representation' });
  return rows?.[0] || null;
}

export async function updateDraft(id, fields) {
  if (!isConfigured() || !id) return;
  await request('PATCH', `/drafts?id=eq.${id}`, fields, { prefer: 'return=minimal' });
}

// Matches an incoming Telegram reply back to the draft it's replying to.
// telegram_reply_message_ids is a Postgres integer[] - `cs` (contains) finds
// the row whose array includes this message id, covering the rare case
// where a long draft got split into multiple Telegram messages.
export async function findPendingDraftByMessageId(messageId) {
  if (!isConfigured()) return null;
  const rows = await request(
    'GET',
    `/drafts?telegram_reply_message_ids=cs.{${messageId}}&status=eq.pending&select=*&limit=1`
  );
  return rows?.[0] || null;
}

// Fallback for when APPROVE/REJECT isn't sent as a native Telegram reply
// (confirmed directly: typing it as a plain new message, without the
// reply gesture, is a real usage pattern) - finds the most recent
// still-pending draft for this chat instead of requiring an exact
// message-id match.
export async function findMostRecentPendingDraft(chatId) {
  if (!isConfigured()) return null;
  const rows = await request(
    'GET',
    `/drafts?select=*,notes!inner(telegram_chat_id)` +
      `&notes.telegram_chat_id=eq.${encodeURIComponent(chatId)}` +
      `&status=eq.pending&order=created_at.desc&limit=1`
  );
  return rows?.[0] || null;
}

// Matches an incoming reply back to the note whose outline it's answering
// - same pattern as findPendingDraftByMessageId, one stage earlier in the
// pipeline (outline proposed, waiting on Meera before drafting starts).
export async function findNoteAwaitingOutlineByMessageId(messageId) {
  if (!isConfigured()) return null;
  const rows = await request(
    'GET',
    `/notes?outline_message_ids=cs.{${messageId}}&status=eq.outline_sent&select=*&limit=1`
  );
  return rows?.[0] || null;
}

// Fallback for a bare reply (not a native Telegram reply) to a pending
// outline - same reasoning as findMostRecentPendingDraft.
export async function findMostRecentNoteAwaitingOutline(chatId) {
  if (!isConfigured()) return null;
  const rows = await request(
    'GET',
    `/notes?telegram_chat_id=eq.${encodeURIComponent(chatId)}` +
      `&status=eq.outline_sent&order=created_at.desc&limit=1`
  );
  return rows?.[0] || null;
}

export async function getActiveVoiceSkillId() {
  if (!isConfigured()) return null;
  const rows = await request('GET', '/voice_skill?is_active=eq.true&select=id&limit=1');
  return rows?.[0]?.id || null;
}

export { isConfigured as isSupabaseConfigured };
