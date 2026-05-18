#!/usr/bin/env node
// Idempotent SwitchBot webhook registration.
// Reads env: SWITCHBOT_API_TOKEN, SWITCHBOT_API_SECRET,
//            SWITCHBOT_WEBHOOK_SECRET, WORKER_URL.
import crypto from 'node:crypto';

const TOKEN = process.env.SWITCHBOT_API_TOKEN;
const SECRET = process.env.SWITCHBOT_API_SECRET;
const WEBHOOK_SECRET = process.env.SWITCHBOT_WEBHOOK_SECRET;
const WORKER_URL = (process.env.WORKER_URL || '').replace(/\/$/, '');

if (!TOKEN || !SECRET || !WEBHOOK_SECRET || !WORKER_URL) {
  console.error('Missing env: SWITCHBOT_API_TOKEN, SWITCHBOT_API_SECRET, SWITCHBOT_WEBHOOK_SECRET, WORKER_URL');
  process.exit(1);
}

const webhookUrl = `${WORKER_URL}/webhook/${WEBHOOK_SECRET}`;

function signHeaders() {
  const t = Date.now().toString();
  const nonce = crypto.randomUUID();
  const sign = crypto
    .createHmac('sha256', SECRET)
    .update(TOKEN + t + nonce)
    .digest('base64');
  return {
    Authorization: TOKEN,
    sign,
    t,
    nonce,
    'Content-Type': 'application/json; charset=utf-8',
  };
}

async function call(action, body) {
  const res = await fetch('https://api.switch-bot.com/v1.1/webhook/' + action, {
    method: 'POST',
    headers: signHeaders(),
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

async function main() {
  console.log(`Target webhook URL: ${webhookUrl}`);

  const q = await call('queryWebhook', { action: 'queryUrl' });
  console.log('queryWebhook:', JSON.stringify(q.json));
  const urls = (q.json && q.json.body && q.json.body.urls) || [];

  if (urls.includes(webhookUrl)) {
    console.log('Webhook already registered. No action needed.');
    return;
  }

  if (urls.length > 0) {
    console.log(`Existing URL differs (${urls.join(', ')}). Updating...`);
    const u = await call('updateWebhook', {
      action: 'updateWebhook',
      config: { url: webhookUrl, enable: true },
    });
    console.log('updateWebhook:', JSON.stringify(u.json));
    if (u.json.statusCode !== 100) {
      console.error('updateWebhook failed; will try setupWebhook');
    } else {
      return;
    }
  }

  const r = await call('setupWebhook', {
    action: 'setupWebhook',
    url: webhookUrl,
    deviceList: 'ALL',
  });
  console.log('setupWebhook:', JSON.stringify(r.json));
  if (r.json.statusCode !== 100) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('register-webhook error:', e);
  process.exit(1);
});
