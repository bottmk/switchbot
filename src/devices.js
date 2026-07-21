// Normalize a MAC/deviceId to a comparable form: keep only hex characters,
// lowercase. Tolerates both "AA:BB:CC:DD:EE:FF" and "AABBCCDDEEFF".
const normMac = (s) => (s || '').toLowerCase().replace(/[^0-9a-f]/g, '');

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

export function lookupRoom(devices, deviceId) {
  if (!deviceId) return undefined;
  const target = normMac(deviceId);
  const found = devices.find((d) => normMac(d.deviceId) === target);
  return found ? found.room : undefined;
}
