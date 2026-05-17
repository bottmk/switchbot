import { loadDevices } from './devices.js';
import { fetchDeviceStatus, calcAbsoluteHumidity, jstTimestamp } from './switchbot.js';
import { tursoPipeline } from './turso.js';

export default {
  /**
   * Cron entry point that 1) loads devices via `loadDevices`, 2) fetches each
   * device's status in parallel via `fetchDeviceStatus`, 3) computes absolute
   * humidity per device via `calcAbsoluteHumidity`, 4) writes all rows in a
   * single Turso bulk insert via `tursoPipeline`.
   * @param {ScheduledEvent} event
   * @param {Record<string, string>} env
   * @param {ExecutionContext} ctx
   * @returns {Promise<void>}
   */
  async scheduled(event, env, ctx) {
    // TODO: orchestrate load → fetch → compute → bulk insert
  },
};
