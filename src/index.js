import { loadDevices, lookupRoom } from './devices.js';
import {
  fetchDeviceStatus,
  calcAbsoluteHumidity,
  jstTimestamp,
  verifyWebhookRequest,
} from './switchbot.js';
import { bulkInsertLogs } from './d1.js';

export default {
  /**
   * Cron entry point that 1) loads devices via `loadDevices`, 2) fetches each
   * device's status in parallel via `fetchDeviceStatus`, 3) computes absolute
   * humidity per device via `calcAbsoluteHumidity`, 4) writes all rows in a
   * single D1 bulk insert via `bulkInsertLogs`.
   * @param {ScheduledEvent} event
   * @param {Record<string, string>} env
   * @param {ExecutionContext} ctx
   * @returns {Promise<void>}
   */
  async scheduled(event, env, ctx) {
    const devices = loadDevices(env);
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
          room: d.room,
          battery,
          source: 'cron',
          timestamp,
        });
      } else {
        failures++;
        console.log(`fetchDeviceStatus failed for ${d.deviceId}: ${r.reason}`);
      }
    }

    if (rows.length > 0) {
      await bulkInsertLogs(env.DB, rows);
    }
    console.log(`scheduled: ${rows.length} ok, ${failures} failed`);
  },

  /**
   * Webhook entry point for SwitchBot `changeReport` events. Verifies the
   * request via path secret, parses the payload, and writes a single row.
   * @param {Request} request
   * @param {Record<string, string>} env
   * @param {ExecutionContext} ctx
   * @returns {Promise<Response>}
   */
  async fetch(request, env, ctx) {
    try {
      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 });
      }
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
        // Acknowledge but ignore unrelated event types / missing fields.
        return new Response(JSON.stringify({ ok: true, ignored: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      const devices = loadDevices(env);
      const row = {
        device_id: wctx.deviceMac,
        temperature: wctx.temperature,
        humidity: wctx.humidity,
        absolute_humidity: calcAbsoluteHumidity(wctx.temperature, wctx.humidity),
        room: lookupRoom(devices, wctx.deviceMac) || 'unknown',
        battery: typeof wctx.battery === 'number' ? wctx.battery : null,
        source: 'webhook',
        timestamp: jstTimestamp(),
      };

      await bulkInsertLogs(env.DB, [row]);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.log(`webhook error: ${err && err.stack ? err.stack : err}`);
      return new Response(JSON.stringify({ ok: false, error: String(err) }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};
