function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  telegramBotToken: () => required('TELEGRAM_BOT_TOKEN'),
  telegramWebhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET || '',
  allowedChatId: process.env.ALLOWED_CHAT_ID || '',

  geminiApiKey: () => required('GEMINI_API_KEY'),
  anthropicApiKey: () => required('ANTHROPIC_API_KEY'),

  draftProvider: (process.env.DRAFT_PROVIDER || 'gemini').toLowerCase(),

  geminiTranscribeModel: process.env.GEMINI_TRANSCRIBE_MODEL || 'gemini-3.5-flash',
  geminiDraftModel: process.env.GEMINI_DRAFT_MODEL || 'gemini-3.5-flash',
  claudeDraftModel: process.env.CLAUDE_DRAFT_MODEL || 'claude-sonnet-4-5',

  // Optional: automatic research (Google Custom Search). Left blank, web
  // search is skipped and the bot falls back to Google News RSS only -
  // never throws, since this is an enhancement, not a hard requirement.
  googleSearchApiKey: process.env.GOOGLE_SEARCH_API_KEY || '',
  googleSearchCx: process.env.GOOGLE_SEARCH_CX || '',
  googleNewsRegion: process.env.GOOGLE_NEWS_REGION || 'IN',
  googleNewsLanguage: process.env.GOOGLE_NEWS_LANGUAGE || 'en',
};
