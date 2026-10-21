-- Portal v3: per-question results stored per snapshot (Day 0 = baseline snapshot)
CREATE TABLE IF NOT EXISTS snapshot_prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  snapshot_id INTEGER NOT NULL REFERENCES snapshots(id),
  client_id INTEGER NOT NULL REFERENCES clients(id),
  prompt TEXT NOT NULL,
  engine TEXT NOT NULL DEFAULT '',
  mentioned INTEGER NOT NULL DEFAULT 0,
  cited INTEGER NOT NULL DEFAULT 0,
  position TEXT NOT NULL DEFAULT '',
  cited_url TEXT NOT NULL DEFAULT '',
  UNIQUE (snapshot_id, prompt, engine)
);
CREATE INDEX IF NOT EXISTS idx_sp_snap ON snapshot_prompts(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_sp_client ON snapshot_prompts(client_id);
