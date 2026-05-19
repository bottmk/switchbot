import {
  fetchDeviceList,
  fetchDeviceStatus,
  lookupDeviceName,
  calcAbsoluteHumidity,
  jstTimestamp,
  verifyWebhookRequest,
} from './switchbot.js';
import { bulkInsertLogs } from './d1.js';
import { DASHBOARD_HTML } from './dashboard.js';

export default {
  async scheduled(event, env, ctx) {
    const devices = await fetchDeviceList(env);
    const timestamp = jstTimestamp();

    const results = await Promise.allSettled(
      devices.map((d) => fetchDeviceStatus(env, d.deviceId)),
    );

    const rows = [];
    let failures = 0;
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const d = devices[i];
      if (r.status === 'fulfilled') {
        const { temperature, humidity, battery } = r.value;
        rows.push({
          device_id: d.deviceId,
          temperature,
          humidity,
          absolute_humidity: calcAbsoluteHumidity(temperature, humidity),
          room: d.name,
          battery,
          source: 'cron',
          timestamp,
        });
      } else {
        failures++;
        console.log(`fetchDeviceStatus failed for ${d.deviceId} (${d.name}): ${r.reason}`);
      }
    }

    if (rows.length > 0) {
      await bulkInsertLogs(env.DB, rows);
    }
    console.log(`scheduled: ${rows.length} ok, ${failures} failed (devices=${devices.length})`);
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    try {
      if (request.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        return new Response(DASHBOARD_HTML, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
        });
      }

      if (request.method === 'GET' && pathname === '/data') {
        return await handleData(env, url);
      }

      if (request.method === 'POST' && pathname.startsWith('/webhook/')) {
        return await handleWebhook(env, request);
      }

      return new Response('Not Found', { status: 404 });
    } catch (err) {
      console.log(`fetch error: ${err && err.stack ? err.stack : err}`);
      return new Response(JSON.stringify({ ok: false, error: String(err) }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};

async function handleData(env, url) {
  const hours = Math.min(Math.max(parseInt(url.searchParams.get('hours') || '24', 10), 1), 24 * 30);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '5000', 10), 1), 20000);
  const room = url.searchParams.get('room');

  // JST cutoff string (stored timestamps are JST 'YYYY-MM-DD HH:MM:SS')
  const cutoff = new Date(Date.now() + 9 * 3600 * 1000 - hours * 3600 * 1000)
    .toISOString().slice(0, 19).replace('T', ' ');

  const params = [cutoff];
  let where = "timestamp >= ?";
  if (room) {
    where += " AND room = ?";
    params.push(room);
  }
  const sql = `SELECT timestamp, device_id, room, temperature, humidity, absolute_humidity, battery, source
               FROM temperature_logs
               WHERE ${where}
               ORDER BY timestamp ASC
               LIMIT ?`;
  params.push(limit);

  const { results } = await env.DB.prepare(sql).bind(...params).all();
  return new Response(JSON.stringify({ rows: results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function handleWebhook(env, request) {
  if (!(await verifyWebhookRequest(env, request))) {
    return new Response('Unauthorized', { status: 401 });
  }

  const payload = await request.json();
  const wctx = payload && payload.context;
  if (
    !payload ||
    payload.eventType !== 'changeReport' ||
    !wctx ||
    typeof wctx.temperature !== 'number' ||
    typeof wctx.humidity !== 'number'
  ) {
    return new Response(JSON.stringify({ ok: true, ignored: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const devices = await fetchDeviceList(env);
  const row = {
    device_id: wctx.deviceMac,
    temperature: wctx.temperature,
    humidity: wctx.humidity,
    absolute_humidity: calcAbsoluteHumidity(wctx.temperature, wctx.humidity),
    room: lookupDeviceName(devices, wctx.deviceMac),
    battery: typeof wctx.battery === 'number' ? wctx.battery : null,
    source: 'webhook',
    timestamp: jstTimestamp(),
  };

  await bulkInsertLogs(env.DB, [row]);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
