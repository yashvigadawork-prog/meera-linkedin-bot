// Points your Telegram bot's webhook at your deployed Vercel URL.
//
// Usage:
//   TELEGRAM_BOT_TOKEN=xxx TELEGRAM_WEBHOOK_SECRET=yyy \
//     node scripts/set-webhook.js https://your-project.vercel.app
//
// Run this once after every deploy where the URL changes (or just once, if
// you're on a stable production domain).

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const baseUrl = process.argv[2];

if (!token) {
  console.error('Set TELEGRAM_BOT_TOKEN in your environment first.');
  process.exit(1);
}
if (!baseUrl) {
  console.error('Usage: node scripts/set-webhook.js https://your-project.vercel.app');
  process.exit(1);
}

const webhookUrl = `${baseUrl.replace(/\/$/, '')}/api/webhook`;

const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    url: webhookUrl,
    secret_token: secret || undefined,
    allowed_updates: ['message', 'edited_message', 'channel_post', 'edited_channel_post'],
  }),
});

const data = await res.json();
console.log(JSON.stringify(data, null, 2));

if (!data.ok) {
  process.exit(1);
}

console.log(`\nWebhook set to: ${webhookUrl}`);
if (!secret) {
  console.log(
    'Warning: no TELEGRAM_WEBHOOK_SECRET was set, so the webhook has no shared-secret check. ' +
      'Set one and rerun this script for better security.'
  );
}
