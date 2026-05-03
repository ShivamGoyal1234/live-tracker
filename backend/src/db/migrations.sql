CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  oauth_provider TEXT NOT NULL,
  oauth_id TEXT NOT NULL,
  name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(oauth_provider, oauth_id)
);

CREATE TABLE IF NOT EXISTS location_history (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  UNIQUE(user_id, recorded_at)
);

CREATE INDEX IF NOT EXISTS idx_location_history_user_time
  ON location_history(user_id, recorded_at DESC);
