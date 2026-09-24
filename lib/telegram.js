import { config } from './config.js';

const API_ROOT = 'https://api.telegram.org';
const TELEGRAM_MESSAGE_LIMIT = 4096;

async function callTelegram(method, body) {
  const token = config.telegramBotToken();
  const res = await fetch(`${API_ROOT}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json();
  if (!data.ok) {
    throw new Error(`Telegram API ${method} failed: ${data.description || res.status}`);
  }
  return data.result;
}

export async function sendChatAction(chatId, action = 'typing') {
  try {
    await callTelegram('sendChatAction', { chat_id: chatId, action });
  } catch {
    // best-effort only, never block the flow on this
  }
}

// Splits on paragraph boundaries where possible so a draft never gets cut
// mid-sentence just because it crossed Telegram's 4096-char limit.
function chunkText(text, limit = TELEGRAM_MESSAGE_LIMIT) {
  if (text.length <= limit) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > limit) {
    let cut = remaining.lastIndexOf('\n\n', limit);
    if (cut < limit * 0.5) cut = remaining.lastIndexOf('\n', limit);
    if (cut < limit * 0.5) cut = limit;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export async function sendMessage(chatId, text) {
  const chunks = chunkText(text);
  for (const chunk of chunks) {
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: chunk,
      disable_web_page_preview: true,
    });
  }
}

export async function getFileDownloadUrl(fileId) {
  const token = config.telegramBotToken();
  const file = await callTelegram('getFile', { file_id: fileId });
  return `${API_ROOT}/file/bot${token}/${file.file_path}`;
}

export async function downloadFileAsBase64(fileId) {
  const url = await getFileDownloadUrl(fileId);
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!res.ok) {
    throw new Error(`Failed to download Telegram file: ${res.status}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer).toString('base64');
}
