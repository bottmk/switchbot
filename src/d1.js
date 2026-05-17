/**
 * Bulk insert temperature_logs rows in a single D1 batch.
 *
 * @param {D1Database} db - bound as env.DB
 * @param {Array<{device_id:string, temperature:number, humidity:number, absolute_humidity:number, room:string, battery:number, source:'cron'|'webhook', timestamp:string}>} rows
 * @returns {Promise<void>}
 */
export async function bulkInsertLogs(db, rows) {
  if (rows.length === 0) return;
  const stmt = db.prepare(
    `INSERT INTO temperature_logs (device_id, timestamp, temperature, humidity, absolute_humidity, room, battery, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const batch = rows.map(r => stmt.bind(
    r.device_id, r.timestamp, r.temperature, r.humidity, r.absolute_humidity, r.room, r.battery, r.source
  ));
  await db.batch(batch);
}
