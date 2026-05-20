#!/usr/bin/env node
// One-shot backfill: replace room='unknown' (or MAC-tail-as-room) rows in D1
// with real device names from the SwitchBot /v1.1/devices API.
//
// Idempotent: each UPDATE is filtered by `room='unknown'` (or the MAC tail), so
// re-running is harmless.
//
// Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
//      SWITCHBOT_API_TOKEN, SWITCHBOT_API_SECRET

import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const DB_NAME = 'switchbot-logs';

const sqlEscape = (s) => String(s).replace(/'/g, "''");
const normMac = (s) => String(s || '').toUpperCase().replace(/[^0-9A-F]/g, '');

function wrangler(args) {
  const res = spawnSync('npx', ['wrangler', ...args], {
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

// wrangler --json output: [{ results: [...], meta: { changes, ... }, ... }]
function parseChanges(stdout) {
  try {
    const j = JSON.parse(stdout);
    const arr = Array.isArray(j) ? j : [j];
    const meta = arr[0]?.meta || {};
    // changes = total rows touched; sometimes nested as `changes` or `rows_written`.
    return Number(meta.changes ?? meta.rows_written ?? 0);
  } catch {
    return null;
  }
}

async function fetchDeviceList() {
  const TOKEN = process.env.SWITCHBOT_API_TOKEN;
  const SECRET = process.env.SWITCHBOT_API_SECRET;
  if (!TOKEN || !SECRET) {
    throw new Error('Missing SWITCHBOT_API_TOKEN / SWITCHBOT_API_SECRET');
  }
  const t = Date.now().toString();
  const nonce = crypto.randomUUID();
  const sign = crypto.createHmac('sha256', SECRET).update(TOKEN + t + nonce).digest('base64');
  const res = await fetch('https://api.switch-bot.com/v1.1/devices', {
    headers: { Authorization: TOKEN, sign, t, nonce, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`device list HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.statusCode !== 100) throw new Error(`device list statusCode ${json.statusCode}: ${json.message}`);
  return (json.body?.deviceList || []).map((d) => ({
    deviceId: normMac(d.deviceId),
    name: d.deviceName || '',
    type: d.deviceType,
  }));
}

function runUpdate(deviceMac, name, matchClause, label) {
  const sql = `UPDATE temperature_logs SET room='${sqlEscape(name)}' WHERE device_id='${sqlEscape(deviceMac)}' AND ${matchClause}`;
  const r = wrangler(['d1', 'execute', DB_NAME, '--remote', '--json', '--command', sql]);
  if (r.code !== 0) {
    console.error(`  [${label}] FAIL: ${r.stderr.slice(0, 400)}`);
    return { ok: false, changes: 0 };
  }
  const changes = parseChanges(r.stdout);
  console.log(`  [${label}] changes=${changes ?? '?'}`);
  return { ok: true, changes: changes || 0 };
}

async function main() {
  console.log('Fetching SwitchBot device list...');
  const devices = await fetchDeviceList();
  console.log(`Got ${devices.length} device(s) from API`);

  let totalUnknown = 0;
  let totalMacTail = 0;
  let failures = 0;

  for (const d of devices) {
    if (!d.name || !d.deviceId) {
      console.log(`SKIP ${d.deviceId || '(no id)'}: no name`);
      continue;
    }
    console.log(`\n${d.deviceId} -> "${d.name}" (${d.type})`);

    // Pass 1: literal 'unknown'
    const r1 = runUpdate(d.deviceId, d.name, `room='unknown'`, 'unknown');
    if (!r1.ok) failures += 1; else totalUnknown += r1.changes;

    // Pass 2: MAC-tail (last 6 chars of deviceId, e.g. '864E85')
    if (d.deviceId.length >= 6) {
      const tail = d.deviceId.slice(-6);
      if (tail !== d.name) {
        const r2 = runUpdate(d.deviceId, d.name, `room='${sqlEscape(tail)}'`, `mac-tail ${tail}`);
        if (!r2.ok) failures += 1; else totalMacTail += r2.changes;
      }
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`  rows updated (room='unknown'): ${totalUnknown}`);
  console.log(`  rows updated (MAC-tail room):  ${totalMacTail}`);
  console.log(`  failed UPDATE statements:      ${failures}`);
  console.log(`  total rows touched:            ${totalUnknown + totalMacTail}`);

  process.exit(failures > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
