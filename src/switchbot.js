/**
 * Generates the `sign` header value (HMAC-SHA256 over `token + t + nonce`, base64).
 * @param {string} token
 * @param {string} secret
 * @param {string} t
 * @param {string} nonce
 * @returns {Promise<string>}
 */
export async function signRequest(token, secret, t, nonce) {
  // TODO:
}

/**
 * GETs `https://api.switch-bot.com/v1.1/devices/{deviceId}/status` with auth
 * headers (`Authorization`, `sign`, `t`, `nonce`).
 * @param {Record<string, string>} env
 * @param {string} deviceId
 * @returns {Promise<{temperature:number, humidity:number, battery:number}>}
 */
export async function fetchDeviceStatus(env, deviceId) {
  // TODO:
}

/**
 * Absolute humidity (g/m³) from temperature `t` (°C) and relative humidity `h` (%).
 * Formula: AH = 217 * (6.1078 * 10^((7.5*T)/(T+237.3))) / (T+273.15) * (H/100)
 * @param {number} t
 * @param {number} h
 * @returns {number}
 */
export function calcAbsoluteHumidity(t, h) {
  // TODO:
}

/**
 * Returns a JST timestamp string suitable for SQLite `DATETIME`.
 * @returns {string}
 */
export function jstTimestamp() {
  // TODO:
}
