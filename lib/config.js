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

  // A Telegram bot token is "<bot_user_id>:<secret>" - the id before the
  // colon is the bot's own Telegram user id. Used to recognize and ignore
  // the bot's own posts (see api/webhook.js): Telegram relays a bot's own
  // channel_post back through the webhook just like anyone else's, so
  // without this the bot re-processes its own drafts as new incoming notes
  // - confirmed directly in production (two drafts got redrafted from
  // their own reply text before this was caught).
  telegramBotId: () => required('TELEGRAM_BOT_TOKEN').split(':')[0],

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
