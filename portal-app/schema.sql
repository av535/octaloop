-- Octaloop client portal schema (D1 / SQLite)
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  is_demo INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL DEFAULT '',
  pw_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','client')),
  client_id INTEGER REFERENCES clients(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  csrf TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  k TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_k ON login_attempts(k, ts);
CREATE TABLE IF NOT EXISTS aeo_prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  prompt TEXT NOT NULL,
  engine TEXT NOT NULL DEFAULT '',
  mentioned INTEGER NOT NULL DEFAULT 0,
  cited INTEGER NOT NULL DEFAULT 0,
  position TEXT NOT NULL DEFAULT '',
  cited_url TEXT NOT NULL DEFAULT '',
  checked_on TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_aeo_client ON aeo_prompts(client_id);
CREATE TABLE IF NOT EXISTS pr_placements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  publication TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  pub_date TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Pitched'
);
CREATE INDEX IF NOT EXISTS idx_pr_client ON pr_placements(client_id);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  kv_key TEXT NOT NULL UNIQUE,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  uploaded_by INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_reports_client ON reports(client_id);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  ts TEXT NOT NULL DEFAULT (datetime('now'))
);
