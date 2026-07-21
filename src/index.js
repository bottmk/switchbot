import {
  fetchDeviceList,
  fetchAllDevices,
  fetchRawStatus,
  sendDeviceCommand,
  fetchDeviceStatus,
  lookupDeviceName,
  calcAbsoluteHumidity,
  jstTimestamp,
  verifyWebhookRequest,
} from './switchbot.js';
import { bulkInsertLogs } from './d1.js';
import { DASHBOARD_HTML } from './dashboard.js';
import { isAuthed, handleLogin, handleLogout, loginHtml } from './auth.js';
import { getFanConfig, saveFanConfig, validateFanConfig, decideFanAction } from './config.js';
import { SETTINGS_HTML } from './settings.js';

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

    // Fan automation (Step 3): evaluate the configured rule against the fresh
    // readings and actuate the fan. Wrapped so it can never break logging.
    const tempByDevice = {};
    for (let i = 0; i < results.length; i++) {
      if (results[i].status === 'fulfilled') {
        tempByDevice[devices[i].deviceId] = results[i].value.temperature;
      }
    }
    try {
      await runFanAutomation(env, tempByDevice);
    } catch (err) {
      console.log(`fan automation error: ${err && err.stack ? err.stack : err}`);
    }

    console.log(`scheduled: ${rows.length} ok, ${failures} failed (devices=${devices.length})`);
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    try {
      // Access control: everything except the login endpoints and the SwitchBot
      // webhook requires a valid session. Unauthed GETs get the login form so a
      // browser can sign in; other methods get 401. (SwitchBot posts to
      // /webhook/ with no cookie, so it must stay public.)
      const isPublic =
        pathname === '/login' ||
        pathname === '/logout' ||
        pathname.startsWith('/webhook/') ||
        pathname === '/control'; // self-authorizes (login session OR API token)
      if (!isPublic && !(await isAuthed(env, request))) {
        if (request.method === 'GET') {
          return new Response(loginHtml(), {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
          });
        }
        return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
      }

      if (request.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        if (!(await isAuthed(env, request))) {
          return new Response(loginHtml(), {
            status: 200,
            headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
          });
        }
        return new Response(DASHBOARD_HTML, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
        });
      }

      if (request.method === 'POST' && pathname === '/login') {
        return await handleLogin(env, request);
      }

      if (request.method === 'GET' && pathname === '/logout') {
        return handleLogout();
      }

      if (request.method === 'GET' && pathname === '/data') {
        if (!(await isAuthed(env, request))) {
          return new Response('Unauthorized', { status: 401 });
        }
        return await handleData(env, url);
      }

      if (request.method === 'GET' && pathname === '/devices/all') {
        const devices = await fetchAllDevices(env);
        return new Response(JSON.stringify(devices, null, 2), {
          status: 200,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
        });
      }

      if (request.method === 'GET' && pathname === '/devices/status') {
        const id = url.searchParams.get('id');
        if (!id) return jsonResponse({ ok: false, error: 'missing ?id=<deviceId>' }, 400);
        const status = await fetchRawStatus(env, id);
        return jsonResponse({ ok: true, deviceId: id, status }, 200);
      }

      if (pathname === '/control' && (request.method === 'GET' || request.method === 'POST')) {
        return await handleControl(env, request, url);
      }

      if (request.method === 'GET' && pathname === '/settings') {
        return new Response(SETTINGS_HTML, {
          status: 200,
          headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
        });
      }

      if (request.method === 'GET' && pathname === '/config') {
        return jsonResponse({ ok: true, config: await getFanConfig(env.DB) }, 200);
      }

      if (request.method === 'POST' && pathname === '/config') {
        return await handleConfigWrite(env, request);
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

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/**
 * Manual device control. Authorized by EITHER a valid login session (browser,
 * no extra key) OR a machine API token via the `X-Api-Key` header / `?token=`
 * (for Home Assistant etc.). `/control` is exempt from the login guard so token
 * clients without a cookie can reach here; auth is enforced below. If
 * WORKER_API_TOKEN is unset, only the login session is accepted (fail-safe).
 *
 * GET  /control?id=<deviceId>&cmd=turnOn        (header: X-Api-Key: <token>)
 * POST /control  {"deviceId","command","parameter","commandType"}
 */
async function handleControl(env, request, url) {
  const token = request.headers.get('X-Api-Key') || url.searchParams.get('token');
  const authorized =
    (await isAuthed(env, request)) ||
    (!!env.WORKER_API_TOKEN && token === env.WORKER_API_TOKEN);
  if (!authorized) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
  }
  const q = url.searchParams;
  let body = {};
  if (request.method === 'POST') {
    body = await request.json().catch(() => ({}));
  }
  const deviceId = body.deviceId ?? q.get('id');
  const command = body.command ?? q.get('cmd') ?? 'turnOn';
  const parameter = body.parameter ?? q.get('parameter') ?? 'default';
  const commandType = body.commandType ?? q.get('commandType') ?? 'command';
  if (!deviceId) return jsonResponse({ ok: false, error: 'missing deviceId (id)' }, 400);

  const result = await sendDeviceCommand(env, deviceId, { command, parameter, commandType });
  return jsonResponse({ ok: true, deviceId, command, parameter, result }, 200);
}

/** Saves fan-automation config from the /settings UI. Gated by the login session. */
async function handleConfigWrite(env, request) {
  // Authorized by the login guard in fetch(); no separate control key required.
  const body = await request.json().catch(() => ({}));
  const config = validateFanConfig(body);
  await saveFanConfig(env.DB, config, jstTimestamp());
  return jsonResponse({ ok: true, config }, 200);
}

/**
 * Evaluates the stored fan-automation rule against the latest sensor reading
 * and, if the fan is not already in the desired state, sends the command.
 * Reading the fan's actual power first makes the loop idempotent (no repeated
 * commands) and respects manual changes made within the hysteresis band.
 */
async function runFanAutomation(env, tempByDevice) {
  const config = await getFanConfig(env.DB);
  if (!config.enabled || !config.fanDeviceId || !config.sensorDeviceId) return;

  const sensorId = String(config.sensorDeviceId).toUpperCase().replace(/[^0-9A-F]/g, '');
  const temperature = tempByDevice[sensorId];
  const jstHour = new Date(Date.now() + 9 * 3600 * 1000).getUTCHours();

  const desired = decideFanAction(config, temperature, jstHour);
  if (!desired) return;

  let power;
  try {
    const status = await fetchRawStatus(env, config.fanDeviceId);
    power = status && status.power;
  } catch (err) {
    console.log(`automation: status fetch failed: ${err}`);
    return;
  }
  if (power === desired) return; // already in the desired state — no command

  const command = desired === 'on' ? 'turnOn' : 'turnOff';
  await sendDeviceCommand(env, config.fanDeviceId, { command });
  console.log(
    `automation: ${command} fan=${config.fanDeviceId} temp=${temperature} on=${config.onC} off=${config.offC} night=${config.night} hour=${jstHour}`,
  );
}

async function handleData(env, url) {
  const hours = Math.min(Math.max(parseInt(url.searchParams.get('hours') || '24', 10), 1), 24 * 30);
  // Default LIMIT must cover the longest selectable range. 7 days × N devices ×
  // 6/h (10-min cron) + webhook rows can easily exceed an old 500-row cap and
  // silently truncate to ~24h worth when ORDER BY timestamp ASC. Use a default
  // that comfortably covers 30d × ~10 devices × ~12/h with headroom.
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50000', 10), 1), 100000);
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
