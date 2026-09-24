import { config } from '../lib/config.js';
import { sendMessage, sendChatAction, downloadFileAsBase64 } from '../lib/telegram.js';
import { transcribeAudio } from '../lib/transcribe.js';
import { generateDraft, buildVerifyFlagBlock, NOT_ENOUGH_PREFIX } from '../lib/draft.js';
import { scoreNote, SCORE_THRESHOLD } from '../lib/score.js';
import {
  insertNote,
  updateNote,
  insertDraft,
  updateDraft,
  findPendingDraftByMessageId,
  getActiveVoiceSkillId,
} from '../lib/supabase.js';

const START_MESSAGE =
  "Hi, I'm your LinkedIn drafting bot.\n\n" +
  'Send me a voice note or a typed fragment - a half-formed thought, a reaction to a customer DM, ' +
  "a manufacturer conversation - and I'll draft a LinkedIn post in your voice, automatically pulling " +
  'in a relevant news angle where one genuinely fits.\n\n' +
  "Every note gets scored first - logistics reminders and abandoned half-thoughts get turned away " +
  "with a reason instead of forcing a shallow draft.\n\n" +
  'Optional: add a line starting with "Angle:" (in a text message, or in the caption of an audio file) ' +
  "to hand me a specific news angle or data point yourself instead of relying on my own search.\n\n" +
  'Reply APPROVE or REJECT to any draft I send to record your decision.\n\n' +
  'I only ever draft. I never post or schedule anything - you review every draft here and post it yourself.';

// Persistence is best-effort: a Supabase hiccup should never stop Meera
// from getting her actual draft. Errors are logged, never thrown further.
async function safe(promise, label) {
  try {
    return await promise;
  } catch (err) {
    console.error(`meera-linkedin-bot: ${label} failed (continuing):`, err);
    return null;
  }
}

// Splits raw input into the actual fragment and an optional supplied
// "Angle:" line, e.g. a news angle or industry data point to weave in.
function parseFragmentAndAngle(rawText) {
  const lines = (rawText || '').split('\n');
  const angleIndex = lines.findIndex((line) => /^\s*angle\s*:/i.test(line));
  if (angleIndex === -1) {
    return { fragment: rawText.trim(), angle: '' };
  }
  const fragment = lines.slice(0, angleIndex).join('\n').trim();
  const firstAngleLine = lines[angleIndex].replace(/^\s*angle\s*:/i, '').trim();
  const angle = [firstAngleLine, ...lines.slice(angleIndex + 1)].join('\n').trim();
  return { fragment, angle };
}

function formatReply(draft, { newsItem, newsUsed }) {
  if (draft.startsWith(NOT_ENOUGH_PREFIX)) {
    return `Need more to go on before I can draft this one.\n\n${draft.slice(NOT_ENOUGH_PREFIX.length).trim()}`;
  }
  const verifyFlag = newsUsed && newsItem ? `\n\n${buildVerifyFlagBlock(newsItem)}` : '';
  return (
    'Draft - for your review only. Nothing has been posted or scheduled.\n' +
    '—\n\n' +
    `${draft}\n\n` +
    '—\n' +
    'You post this yourself, whenever and if you want to.\n' +
    'Reply APPROVE or REJECT to record your decision.' +
    verifyFlag
  );
}

function formatRejectionMessage(score, reason) {
  return (
    "I'm not drafting this one.\n\n" +
    `Score: ${score}/10 — ${reason}\n\n` +
    "Send it again with more to work with (a specific incident, number, or opinion) if there's more there."
  );
}

// Returns true if the message was handled as an APPROVE/REJECT reply
// (whether or not it matched a tracked draft), false if it should fall
// through to normal note handling.
async function handleApproveReject(message) {
  if (!message.reply_to_message || typeof message.text !== 'string') return false;
  const decision = message.text.trim().toUpperCase();
  if (decision !== 'APPROVE' && decision !== 'REJECT') return false;

  const chatId = message.chat.id;
  const draftRow = await safe(
    findPendingDraftByMessageId(message.reply_to_message.message_id),
    'findPendingDraftByMessageId'
  );

  if (!draftRow) {
    await sendMessage(chatId, "I couldn't find a pending draft matching that reply.");
    return true;
  }

  const status = decision === 'APPROVE' ? 'approved' : 'rejected';
  await safe(
    updateDraft(draftRow.id, { status, decided_at: new Date().toISOString() }),
    'updateDraft (approve/reject)'
  );
  await sendMessage(
    chatId,
    status === 'approved' ? 'Marked as approved.' : 'Marked as rejected - kept on file for review.'
  );
  return true;
}

async function handleMessage(message) {
  const chatId = message.chat.id;

  if (typeof message.text === 'string' && message.text.trim().startsWith('/start')) {
    await sendMessage(chatId, START_MESSAGE);
    return;
  }

  if (await handleApproveReject(message)) return;

  let fragment = '';
  let angle = '';
  let sourceType = 'text';

  if (message.voice || message.audio) {
    const media = message.voice || message.audio;
    const mimeType = media.mime_type || 'audio/ogg';
    sourceType = 'voice';

    await sendChatAction(chatId, 'typing');
    const base64Audio = await downloadFileAsBase64(media.file_id);
    fragment = await transcribeAudio(base64Audio, mimeType);

    if (message.caption) {
      ({ angle } = parseFragmentAndAngle(message.caption));
    }
  } else if (typeof message.text === 'string' && message.text.trim()) {
    ({ fragment, angle } = parseFragmentAndAngle(message.text));
  } else {
    await sendMessage(
      chatId,
      "I can only work with a voice note or a typed message right now - send me one of those."
    );
    return;
  }

  if (!fragment) {
    await sendMessage(chatId, "That came through empty - send the fragment again?");
    return;
  }

  const noteRow = await safe(
    insertNote({
      telegram_chat_id: String(chatId),
      telegram_message_id: message.message_id,
      source_type: sourceType,
      raw_text: message.text || message.caption || null,
      transcript: fragment,
      manual_angle: angle || null,
      status: 'pending',
    }),
    'insertNote'
  );

  await sendChatAction(chatId, 'typing');
  const { score, reason } = await scoreNote(fragment);
  if (score < SCORE_THRESHOLD) {
    await safe(
      updateNote(noteRow?.id, { status: 'scored_low', score, score_reason: reason }),
      'updateNote (scored_low)'
    );
    await sendMessage(chatId, formatRejectionMessage(score, reason));
    return;
  }
  await safe(
    updateNote(noteRow?.id, { status: 'scored_high', score, score_reason: reason }),
    'updateNote (scored_high)'
  );

  await sendChatAction(chatId, 'typing');
  const { draft, newsItem, newsUsed } = await generateDraft(fragment, angle);
  const replyMessageIds = await sendMessage(chatId, formatReply(draft, { newsItem, newsUsed }));

  // The "not enough to draft" fallback isn't a real, postable draft - it's
  // a clarifying question - so it isn't saved as one, and there's nothing
  // for her to APPROVE/REJECT.
  if (draft.startsWith(NOT_ENOUGH_PREFIX)) return;

  const voiceSkillId = await safe(getActiveVoiceSkillId(), 'getActiveVoiceSkillId');
  await safe(
    insertDraft({
      note_id: noteRow?.id,
      voice_skill_id: voiceSkillId,
      draft_text: draft,
      news_used: newsUsed,
      news_headline: newsItem?.headline || null,
      news_source: newsItem?.source || null,
      news_date: newsItem?.date || null,
      news_link: newsItem?.link || null,
      telegram_reply_message_ids: replyMessageIds,
      status: 'pending',
    }),
    'insertDraft'
  );
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(200).send('Meera LinkedIn draft bot webhook is running.');
    return;
  }

  if (config.telegramWebhookSecret) {
    const incomingSecret = req.headers['x-telegram-bot-api-secret-token'];
    if (incomingSecret !== config.telegramWebhookSecret) {
      res.status(401).json({ ok: false, error: 'invalid secret token' });
      return;
    }
  }

  const update = req.body || {};
  // Meera posts into a channel, so most updates arrive as channel_post, not
  // message - a bot only gets `message` updates from a direct 1:1 chat or a
  // group. Handle both shapes.
  const message =
    update.message || update.edited_message || update.channel_post || update.edited_channel_post;

  // Always ack fast with 200 so Telegram doesn't retry-storm us; do the
  // actual work first since Vercel functions don't run work after response.
  if (!message || !message.chat) {
    res.status(200).json({ ok: true });
    return;
  }

  const chatId = message.chat.id;
  if (config.allowedChatId && String(chatId) !== String(config.allowedChatId)) {
    // Not Meera's chat - ignore silently, don't leak that the bot exists.
    res.status(200).json({ ok: true });
    return;
  }

  try {
    await handleMessage(message);
  } catch (err) {
    console.error('meera-linkedin-bot error:', err);
    try {
      await sendMessage(
        chatId,
        `Something went wrong drafting that one: ${err.message}\n\nTry sending it again.`
      );
    } catch (sendErr) {
      console.error('meera-linkedin-bot: also failed to report error to chat:', sendErr);
    }
  }

  res.status(200).json({ ok: true });
}
