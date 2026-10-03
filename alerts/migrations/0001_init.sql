-- Streamers, how they sign in, and every order (tips and plan purchases). Apply with: npx wrangler d1 migrations apply alerts --remote

CREATE TABLE users (
  id          TEXT PRIMARY KEY,
  handle      TEXT UNIQUE,                 -- their tip page: /alerts/@handle (set at onboarding)
  display     TEXT,
  payout      TEXT,                        -- the wallet tips are paid to (straight from the viewer, never through us)
  overlay_key TEXT NOT NULL UNIQUE,        -- the secret in their browser source link (can be regenerated)
  settings    TEXT NOT NULL DEFAULT '{}',  -- alert look, sound, voice, minimums, filters (JSON)
  pro_until   INTEGER NOT NULL DEFAULT 0,  -- annual plan paid up to (unix seconds): no fee on tips until then
  created     INTEGER NOT NULL
);

CREATE TABLE identities (
  provider TEXT NOT NULL,                  -- 'solana' (wallet address) or 'google' (Google account id)
  subject  TEXT NOT NULL,
  user_id  TEXT NOT NULL REFERENCES users(id),
  email    TEXT,
  created  INTEGER NOT NULL,
  PRIMARY KEY (provider, subject)
);
CREATE INDEX identities_user ON identities(user_id);

CREATE TABLE orders (
  id        TEXT PRIMARY KEY,
  kind      TEXT NOT NULL,                 -- 'tip' or 'plan'
  user_id   TEXT NOT NULL REFERENCES users(id),
  from_name TEXT,
  text      TEXT,
  token     TEXT NOT NULL,                 -- 'usdc' or 'sol'
  usd       REAL NOT NULL,
  legs      TEXT NOT NULL,                 -- JSON [{to, amount}] in base units: who gets what, fixed when the order is made
  reference TEXT NOT NULL UNIQUE,          -- Solana Pay reference key: finds the payment on chain
  status    TEXT NOT NULL DEFAULT 'pending', -- pending | paid | expired
  alert     TEXT,                          -- tips: queued | held | played | skipped | rejected
  payer     TEXT,
  sig       TEXT UNIQUE,
  created   INTEGER NOT NULL,
  paid_at   INTEGER,
  played_at INTEGER
);
CREATE INDEX orders_user ON orders(user_id, created);
CREATE INDEX orders_pending ON orders(status, created);

CREATE TABLE nonces (n TEXT PRIMARY KEY, exp INTEGER NOT NULL);
