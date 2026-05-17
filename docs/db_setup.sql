CREATE TABLE IF NOT EXISTS temperature_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL,
  timestamp DATETIME DEFAULT (datetime('now', '+9 hours')),
  temperature REAL,
  humidity REAL,
  absolute_humidity REAL,
  room TEXT,
  battery INTEGER,
  source TEXT NOT NULL DEFAULT 'cron'
);
CREATE INDEX IF NOT EXISTS idx_temp_logs_device_time
  ON temperature_logs(device_id, timestamp);
