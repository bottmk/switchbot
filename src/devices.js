/**
 * Parses `env.DEVICES` (a JSON string) into an array of `{deviceId, room}`.
 * @param {Record<string, string>} env
 * @returns {Array<{deviceId:string, room:string}>}
 */
export function loadDevices(env) {
  const parsed = JSON.parse(env.DEVICES || '[]');
  if (!Array.isArray(parsed)) throw new Error('Invalid DEVICES env');
  for (const d of parsed) {
    if (!d || typeof d.deviceId !== 'string' || typeof d.room !== 'string') {
      throw new Error('Invalid DEVICES env');
    }
  }
  return parsed;
}

/**
 * Looks up a device's room by deviceId (case-insensitive — MAC casing varies
 * between SwitchBot API responses and webhook payloads).
 * @param {Array<{deviceId:string, room:string}>} devices
 * @param {string} deviceId
 * @returns {string | undefined}
 */
export function lookupRoom(devices, deviceId) {
  if (!deviceId) return undefined;
  const target = deviceId.toLowerCase();
  const found = devices.find((d) => d.deviceId.toLowerCase() === target);
  return found ? found.room : undefined;
}
