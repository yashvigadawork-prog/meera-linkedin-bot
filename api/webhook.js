import { config } from '../lib/config.js';
import { sendMessage, sendChatAction, downloadFileAsBase64 } from '../lib/telegram.js';
import { transcribeAudio } from '../lib/transcribe.js';
import { generateDraft } from '../lib/draft.js';

const START_MESSAGE =
  "Hi, I'm your LinkedIn drafting bot.\n\n" +
  'Send me a voice note or a typed fragment - a half-formed thought, a reaction to a customer DM, ' +
  'a manufacturer conversation - and I\'ll draft a LinkedIn post in your voice.\n\n' +
  'Optional: add a line starting with "Angle:" (in a text message, or in the caption of an audio file) ' +
  'to give me a news angle or data point to weave in.\n\n' +
  'I only ever draft. I never post or schedule anything - you review every draft here and post it yourself.';

const NOT_ENOUGH_PREFIX = 'NOT ENOUGH TO DRAFT:';

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

function formatReply(draft) {
  if (draft.startsWith(NOT_ENOUGH_PREFIX)) {
    return `Need more to go on before I can draft this one.\n\n${draft.slice(NOT_ENOUGH_PREFIX.length).trim()}`;
  }
  return (
    'Draft - for your review only. Nothing has been posted or scheduled.\n' +
    '—\n\n' +
    `${draft}\n\n` +
    '—\n' +
    'You post this yourself, whenever and if you want to.'
  );
}

async function handleMessage(message) {
  const chatId = message.chat.id;

  if (typeof message.text === 'string' && message.text.trim().startsWith('/start')) {
    await sendMessage(chatId, START_MESSAGE);
    return;
  }

  let fragment = '';
  let angle = '';

  if (message.voice || message.audio) {
    const media = message.voice || message.audio;
    const mimeType = media.mime_type || 'audio/ogg';

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

  await sendChatAction(chatId, 'typing');
  const draft = await generateDraft(fragment, angle);
  await sendMessage(chatId, formatReply(draft));
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
