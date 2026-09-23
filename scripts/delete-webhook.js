// Removes the webhook (e.g. to pause the bot, or before switching to a new URL).
//
// Usage:
//   TELEGRAM_BOT_TOKEN=xxx node scripts/delete-webhook.js

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('Set TELEGRAM_BOT_TOKEN in your environment first.');
  process.exit(1);
}

const res = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`, {
  method: 'POST',
});
const data = await res.json();
console.log(JSON.stringify(data, null, 2));
if (!data.ok) process.exit(1);
