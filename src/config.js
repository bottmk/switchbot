/**
 * Persistent application config stored in D1 (survives deploys; editable from
 * the /settings UI without a redeploy). Uses a tiny key/value table that the
 * Worker creates on demand, so no separate migration workflow is required.
 */

// Fan-automation defaults. enabled:false is the fail-safe — deploying the code
// never starts controlling hardware until the operator turns it on in the UI.
export const DEFAULT_FAN_CONFIG = {
  enabled: false,
  fanDeviceId: '',
  sensorDeviceId: '',
  onC: 28,
  offC: 26,
  // 'allday'  — automate day and night
  // 'no-on'   — never turn ON during the night window (still allowed to turn OFF)
  // 'off'     — no automation at all during the night window
  night: 'no-on',
};

// JST night window [start, end) in hours. 23:00–07:00.
export const NIGHT_START_HOUR = 23;
export const NIGHT_END_HOUR = 7;

async function ensureConfigTable(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT)`,
    )
    .run();
}

/** Returns the stored fan config merged over defaults (defaults if none/invalid). */
export async function getFanConfig(db) {
  await ensureConfigTable(db);
  const row = await db.prepare(`SELECT value FROM app_config WHERE key='fan_automation'`).first();
  if (!row || !row.value) return { ...DEFAULT_FAN_CONFIG };
  try {
    return { ...DEFAULT_FAN_CONFIG, ...JSON.parse(row.value) };
  } catch {
    return { ...DEFAULT_FAN_CONFIG };
  }
}

/**
 * Coerces arbitrary UI input into a safe fan config. Clamps thresholds and
 * enforces hysteresis (offC strictly below onC) so the rule can never oscillate.
 */
export function validateFanConfig(input) {
  const c = { ...DEFAULT_FAN_CONFIG };
  if (typeof input.enabled === 'boolean') c.enabled = input.enabled;
  if (typeof input.fanDeviceId === 'string') c.fanDeviceId = input.fanDeviceId.trim();
  if (typeof input.sensorDeviceId === 'string') c.sensorDeviceId = input.sensorDeviceId.trim();
  const on = Number(input.onC);
  const off = Number(input.offC);
  if (Number.isFinite(on)) c.onC = Math.min(Math.max(on, -20), 60);
  if (Number.isFinite(off)) c.offC = Math.min(Math.max(off, -20), 60);
  if (['allday', 'no-on', 'off'].includes(input.night)) c.night = input.night;
  if (c.offC >= c.onC) c.offC = c.onC - 1; // guarantee a hysteresis band
  return c;
}

/** Upserts the fan config JSON. */
export async function saveFanConfig(db, config, updatedAt) {
  await ensureConfigTable(db);
  await db
    .prepare(
      `INSERT INTO app_config (key, value, updated_at) VALUES ('fan_automation', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
    )
    .bind(JSON.stringify(config), updatedAt)
    .run();
}

/**
 * Decides the action for the fan given a sensor temperature and the current
 * JST hour. Returns 'on', 'off', or null (no change). Pure function — easy to
 * unit test and reason about.
 */
export function decideFanAction(config, temperature, jstHour) {
  if (!config || !config.enabled) return null;
  if (!config.fanDeviceId || !config.sensorDeviceId) return null;
  if (typeof temperature !== 'number' || !Number.isFinite(temperature)) return null;

  const isNight = jstHour >= NIGHT_START_HOUR || jstHour < NIGHT_END_HOUR;
  if (isNight && config.night === 'off') return null;

  let desired = null;
  if (temperature >= config.onC) desired = 'on';
  else if (temperature <= config.offC) desired = 'off';
  // between offC and onC → null (hysteresis band, no change)

  if (isNight && config.night === 'no-on' && desired === 'on') desired = null;
  return desired;
}
