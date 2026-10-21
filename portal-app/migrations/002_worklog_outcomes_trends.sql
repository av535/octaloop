-- Portal v2: work log, outcomes (AI-referral traffic, demos, leads), snapshots/baseline, GA4 settings
CREATE TABLE IF NOT EXISTS worklog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  week TEXT NOT NULL,               -- Monday of the week, YYYY-MM-DD
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  qty INTEGER,                      -- optional count
  link TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Done'
);
CREATE INDEX IF NOT EXISTS idx_worklog_client ON worklog(client_id, week);
CREATE TABLE IF NOT EXISTS outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  week TEXT NOT NULL,
  ai_sessions INTEGER,
  ai_breakdown TEXT NOT NULL DEFAULT '',   -- JSON {source: sessions}
  demos INTEGER,
  leads INTEGER,
  source TEXT NOT NULL DEFAULT 'manual',   -- manual | csv | ga4
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (client_id, week)
);
CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  week TEXT NOT NULL,
  is_baseline INTEGER NOT NULL DEFAULT 0,
  mention_rate REAL,
  citation_rate REAL,
  avg_position REAL,
  placements INTEGER,
  ai_sessions INTEGER,
  demos INTEGER,
  leads INTEGER,
  positions_json TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (client_id, week)
);
CREATE TABLE IF NOT EXISTS client_settings (
  client_id INTEGER PRIMARY KEY REFERENCES clients(id),
  ga4_property_id TEXT NOT NULL DEFAULT '',
  ga4_lead_events TEXT NOT NULL DEFAULT '',   -- comma-separated key event names counted as leads
  ga4_demo_events TEXT NOT NULL DEFAULT '',   -- comma-separated key event names counted as demos
  ga4_last_sync TEXT NOT NULL DEFAULT '',
  ga4_last_error TEXT NOT NULL DEFAULT '',
  onboarded_on TEXT NOT NULL DEFAULT ''
);
