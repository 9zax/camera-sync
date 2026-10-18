CREATE TABLE IF NOT EXISTS users(
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'web',
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS events(
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  partner_a TEXT NOT NULL DEFAULT '',
  partner_b TEXT NOT NULL DEFAULT '',
  event_date TEXT NOT NULL DEFAULT '',
  pin TEXT NOT NULL DEFAULT '',
  face_enabled INTEGER NOT NULL DEFAULT 1,
  upload_token TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS photos(
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  orig_hash TEXT NOT NULL,
  filename TEXT NOT NULL,
  ext TEXT NOT NULL DEFAULT 'jpg',
  bytes INTEGER NOT NULL,
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  taken_at INTEGER,
  status TEXT NOT NULL DEFAULT 'queued',      -- queued|processing|ready|failed
  face_status TEXT NOT NULL DEFAULT 'queued', -- queued|processing|done|disabled|unavailable|failed
  error TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_photos_event_hash ON photos(event_id, orig_hash);
CREATE INDEX IF NOT EXISTS idx_photos_event_created ON photos(event_id, created_at DESC);

CREATE TABLE IF NOT EXISTS faces(
  id TEXT PRIMARY KEY,
  photo_id TEXT NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  x1 REAL NOT NULL, y1 REAL NOT NULL, x2 REAL NOT NULL, y2 REAL NOT NULL,
  score REAL NOT NULL,
  embedding BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_faces_photo ON faces(photo_id);
