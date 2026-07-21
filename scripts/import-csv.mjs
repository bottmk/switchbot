#!/usr/bin/env node
// Bulk-import SwitchBot CSV exports into Cloudflare D1.
//
// For each CSV listed in data/historical/_mapping.json, the script:
//  1) looks up the cutoff = MIN(timestamp) of existing cron/webhook rows
//     for the mapped device_id (so live data is never overlapped)
//  2) parses the CSV, filters rows older than the cutoff
//  3) computes our absolute_humidity from temperature/humidity
//  4) keeps CSV's own Abs Humidity value in absolute_humidity_orig
//  5) writes an INSERT batch to a tmp .sql file and executes it via wrangler
//
// Env: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
//      SWITCHBOT_API_TOKEN, SWITCHBOT_API_SECRET (for device names)

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const HIST_DIR = 'data/historical';
const MAPPING_FILE = path.join(HIST_DIR, '_mapping.json');
const DB_NAME = 'switchbot-logs';
const BATCH_SIZE = 200; // INSERT statements per wrangler invocation

if (!fs.existsSync(MAPPING_FILE)) {
  console.error(`Missing ${MAPPING_FILE}`);
  process.exit(1);
}
const mapping = JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf8'));

const sqlEscape = (s) => String(s).replace(/'/g, "''");
const normMac = (s) => String(s || '').toUpperCase().replace(/[^0-9A-F]/g, '');

function calcAH(t, h) {
  const ah = (217 * (6.1078 * Math.pow(10, (7.5 * t) / (t + 237.3)))) / (t + 273.15) * (h / 100);
  return Math.round(ah * 100) / 100;
}

function wrangler(args) {
  const res = spawnSync('npx', ['wrangler', ...args], {
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function getCutoff(deviceId) {
  // returns ISO-ish 'YYYY-MM-DD HH:MM:SS' or null
  const sql = `SELECT MIN(timestamp) AS t FROM temperature_logs WHERE device_id='${sqlEscape(deviceId)}' AND source IN ('cron','webhook','import')`;
  const r = wrangler(['d1', 'execute', DB_NAME, '--remote', '--json', '--command', sql]);
  if (r.code !== 0) {
    console.error(`cutoff query failed for ${deviceId}: ${r.stderr}`);
    return null;
  }
  try {
    const j = JSON.parse(r.stdout);
    // wrangler --json shape: [{ results: [{ t: '...' }], ... }]
    const arr = Array.isArray(j) ? j : [j];
    const t = arr[0]?.results?.[0]?.t ?? null;
    return t || null;
  } catch (e) {
    console.error(`cutoff parse failed for ${deviceId}: ${e}`);
    return null;
  }
}

async function fetchDeviceNames() {
  const TOKEN = process.env.SWITCHBOT_API_TOKEN;
  const SECRET = process.env.SWITCHBOT_API_SECRET;
  if (!TOKEN || !SECRET) return new Map();
  const t = Date.now().toString();
  const nonce = crypto.randomUUID();
  const sign = crypto.createHmac('sha256', SECRET).update(TOKEN + t + nonce).digest('base64');
  let res;
  try {
    res = await fetch('https://api.switch-bot.com/v1.1/devices', {
      headers: { Authorization: TOKEN, sign, t, nonce, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error('device list fetch failed:', e);
    return new Map();
  }
  if (!res.ok) {
    console.error('device list HTTP', res.status);
    return new Map();
  }
  const json = await res.json();
  const m = new Map();
  for (const d of json?.body?.deviceList || []) {
    m.set(normMac(d.deviceId), d.deviceName || normMac(d.deviceId));
  }
  return m;
}

function parseCsv(filepath) {
  const text = fs.readFileSync(filepath, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const header = lines[0].split(',');
  const idx = {
    date: header.findIndex((h) => /date/i.test(h)),
    temp: header.findIndex((h) => /temperature/i.test(h)),
    humid: header.findIndex((h) => /relative_humidity|^humidity/i.test(h)),
    ah: header.findIndex((h) => /abs.*humidity/i.test(h)),
  };
  if (idx.date < 0 || idx.temp < 0 || idx.humid < 0) {
    throw new Error(`Unrecognized CSV header: ${header.join(',')}`);
  }
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    let ts = cols[idx.date].trim();
    // "2025-01-08 21:16" -> "2025-01-08 21:16:00"
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(ts)) ts += ':00';
    const temperature = parseFloat(cols[idx.temp]);
    const humidity = parseFloat(cols[idx.humid]);
    const ah_orig = idx.ah >= 0 ? parseFloat(cols[idx.ah]) : null;
    if (!Number.isFinite(temperature) || !Number.isFinite(humidity)) continue;
    out.push({ timestamp: ts, temperature, humidity, ah_orig: Number.isFinite(ah_orig) ? ah_orig : null });
  }
  return out;
}

async function importFile(filename, deviceId, names) {
  const filepath = path.join(HIST_DIR, filename);
  const deviceMac = normMac(deviceId);
  const room = names.get(deviceMac) || deviceMac;
  console.log(`\n=== ${filename} (deviceId=${deviceMac}, room=${room}) ===`);

  const cutoff = getCutoff(deviceMac);
  console.log(`cutoff: ${cutoff || '(no live data — import all)'}`);

  const rows = parseCsv(filepath);
  console.log(`parsed: ${rows.length} rows`);

  const eligible = cutoff
    ? rows.filter((r) => r.timestamp < cutoff)
    : rows;
  console.log(`eligible (< cutoff): ${eligible.length}`);

  if (eligible.length === 0) return { filename, inserted: 0, skipped: rows.length };

  let inserted = 0;
  for (let start = 0; start < eligible.length; start += BATCH_SIZE) {
    const batch = eligible.slice(start, start + BATCH_SIZE);
    const sql = batch
      .map((r) => {
        const ah_calc = calcAH(r.temperature, r.humidity);
        const ah_orig = r.ah_orig != null ? r.ah_orig : 'NULL';
        return `INSERT OR IGNORE INTO temperature_logs (device_id, timestamp, temperature, humidity, absolute_humidity, absolute_humidity_orig, room, source) VALUES ('${sqlEscape(deviceMac)}', '${sqlEscape(r.timestamp)}', ${r.temperature}, ${r.humidity}, ${ah_calc}, ${ah_orig}, '${sqlEscape(room)}', 'import');`;
      })
      .join('\n');
    const sqlFile = `/tmp/import-${deviceMac}-${start}.sql`;
    fs.writeFileSync(sqlFile, sql);
    const r = wrangler(['d1', 'execute', DB_NAME, '--remote', '--file', sqlFile]);
    if (r.code !== 0) {
      console.error(`batch ${start} failed: ${r.stderr.slice(0, 500)}`);
      break;
    }
    inserted += batch.length;
    process.stdout.write(`.`);
  }
  process.stdout.write('\n');
  console.log(`inserted: ${inserted}`);
  return { filename, inserted, skipped: rows.length - inserted };
}

async function main() {
  console.log('Fetching device names from SwitchBot API...');
  const names = await fetchDeviceNames();
  console.log(`Got ${names.size} device(s) from API`);

  const summary = [];
  for (const [filename, deviceId] of Object.entries(mapping)) {
    if (filename.startsWith('_')) continue;
    if (!fs.existsSync(path.join(HIST_DIR, filename))) {
      console.log(`SKIP ${filename}: file not found`);
      continue;
    }
    const s = await importFile(filename, deviceId, names);
    summary.push(s);
  }

  console.log('\n=== SUMMARY ===');
  for (const s of summary) {
    console.log(`  ${s.filename}: inserted=${s.inserted} skipped=${s.skipped}`);
  }
  console.log(`Total inserted: ${summary.reduce((a, s) => a + s.inserted, 0)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
