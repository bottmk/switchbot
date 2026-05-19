/**
 * Generates the `sign` header value (HMAC-SHA256 over `token + t + nonce`, base64).
 * @param {string} token
 * @param {string} secret
 * @param {string} t
 * @param {string} nonce
 * @returns {Promise<string>}
 */
export async function signRequest(token, secret, t, nonce) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(token + t + nonce));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

/**
 * GETs `https://api.switch-bot.com/v1.1/devices/{deviceId}/status` with auth
 * headers (`Authorization`, `sign`, `t`, `nonce`).
 * @param {Record<string, string>} env
 * @param {string} deviceId
 * @returns {Promise<{temperature:number, humidity:number, battery:number}>}
 */
export async function fetchDeviceStatus(env, deviceId) {
  // SwitchBot API expects MAC without separators, uppercase.
  const apiId = String(deviceId || '').toUpperCase().replace(/[^0-9A-F]/g, '');
  const t = Date.now().toString();
  const nonce = crypto.randomUUID();
  const sign = await signRequest(env.SWITCHBOT_API_TOKEN, env.SWITCHBOT_API_SECRET, t, nonce);

  const response = await fetch(`https://api.switch-bot.com/v1.1/devices/${apiId}/status`, {
    method: 'GET',
    headers: {
      Authorization: env.SWITCHBOT_API_TOKEN,
      sign,
      t,
      nonce,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`SwitchBot API ${response.status}: ${await response.text()}`);
  }

  const json = await response.json();
  if (json.statusCode !== 100) {
    throw new Error(`SwitchBot API statusCode ${json.statusCode}: ${json.message}`);
  }

  return {
    temperature: json.body.temperature,
    humidity: json.body.humidity,
    battery: json.body.battery,
  };
}

/**
 * Absolute humidity (g/m³) from temperature `t` (°C) and relative humidity `h` (%).
 * Formula: AH = 217 * (6.1078 * 10^((7.5*T)/(T+237.3))) / (T+273.15) * (H/100)
 * @param {number} t
 * @param {number} h
 * @returns {number}
 */
export function calcAbsoluteHumidity(t, h) {
  const ah = (217 * (6.1078 * Math.pow(10, (7.5 * t) / (t + 237.3)))) / (t + 273.15) * (h / 100);
  return Math.round(ah * 100) / 100;
}

/**
 * Returns a JST timestamp string suitable for SQLite `DATETIME`.
 * Format: `YYYY-MM-DD HH:MM:SS`.
 * @returns {string}
 */
export function jstTimestamp() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Verifies an incoming webhook request by checking the URL path contains the
 * shared secret (SwitchBot v1.1 webhooks have no body-signing mechanism, so we
 * rely on a path-embedded secret registered with SwitchBot).
 * @param {Record<string, string>} env
 * @param {Request} request
 * @returns {Promise<boolean>}
 */
export async function verifyWebhookRequest(env, request) {
  if (!env.SWITCHBOT_WEBHOOK_SECRET) return false;
  const expected = '/webhook/' + env.SWITCHBOT_WEBHOOK_SECRET;
  const actual = new URL(request.url).pathname;
  // Constant-time-ish compare; timing attack against a URL secret is largely
  // theoretical but cheap to guard against.
  if (expected.length !== actual.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  }
  return diff === 0;
}
