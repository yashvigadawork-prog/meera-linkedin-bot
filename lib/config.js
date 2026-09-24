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

  // Automatic research: Google News RSS, no key needed. Region/language
  // bias defaults to India/English, matching Skinstinct's market.
  googleNewsRegion: process.env.GOOGLE_NEWS_REGION || 'IN',
  googleNewsLanguage: process.env.GOOGLE_NEWS_LANGUAGE || 'en',

  // Memory layer (Supabase). Optional at the config level - left blank,
  // lib/supabase.js no-ops every call rather than throwing, so persistence
  // being unconfigured degrades gracefully instead of breaking drafting.
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseServiceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
};
