CREATE TABLE IF NOT EXISTS users(phone text PRIMARY KEY, access_until timestamptz, created_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS admins(id serial PRIMARY KEY, email text UNIQUE NOT NULL, pass_hash text NOT NULL, name text NOT NULL);
CREATE TABLE IF NOT EXISTS sponsors(id serial PRIMARY KEY, email text UNIQUE NOT NULL, pass_hash text NOT NULL, name text NOT NULL);
CREATE TABLE IF NOT EXISTS campaigns(id serial PRIMARY KEY, sponsor_id int REFERENCES sponsors(id), brand text NOT NULL, msg text NOT NULL,
  video_url text, cpv int NOT NULL CHECK(cpv>=20), budget int NOT NULL DEFAULT 0, views int NOT NULL DEFAULT 0, active boolean DEFAULT true);
CREATE TABLE IF NOT EXISTS ad_sessions(token text PRIMARY KEY, phone text, campaign_id int, cpv int, started_at timestamptz DEFAULT now(), claimed boolean DEFAULT false);
CREATE TABLE IF NOT EXISTS vouchers(code text PRIMARY KEY, minutes int NOT NULL, used boolean DEFAULT false);
CREATE TABLE IF NOT EXISTS payments(reference text PRIMARY KEY, kind text, amount int, created_at timestamptz DEFAULT now());
-- FreeRADIUS reads these two tables
CREATE TABLE IF NOT EXISTS radcheck(id serial PRIMARY KEY, username text NOT NULL, attribute text NOT NULL, op varchar(2) NOT NULL DEFAULT ':=', value text NOT NULL);
CREATE TABLE IF NOT EXISTS radreply(id serial PRIMARY KEY, username text NOT NULL, attribute text NOT NULL, op varchar(2) NOT NULL DEFAULT '=', value text NOT NULL);
CREATE INDEX IF NOT EXISTS radcheck_u ON radcheck(username); CREATE INDEX IF NOT EXISTS radreply_u ON radreply(username);
