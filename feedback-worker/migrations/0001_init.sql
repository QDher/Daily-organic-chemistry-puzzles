-- Shared results, ratings and difficulty answers for One-Pot Puzzles (site 'onepot') and
-- Name Reaction Daily (site 'namerxn'). SQLite (Cloudflare D1) port of supabase/schema.sql.
-- Visitors write through the Worker (src/index.js), which validates every field; the checks below repeat
-- the same rules. One row per site, problem and visitor in each table.
-- Times are UTC text in ISO 8601 format (2026-11-11T01:02:03.456Z) so that they sort as text.

CREATE TABLE results (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  site        TEXT    NOT NULL CHECK (site IN ('onepot', 'namerxn')),
  problem_id  TEXT    NOT NULL CHECK (length(problem_id) BETWEEN 1 AND 120),
  client_id   TEXT    NOT NULL CHECK (length(client_id) = 36),
  checks      INTEGER NOT NULL CHECK (checks BETWEEN 0 AND 999),
  hints       INTEGER NOT NULL CHECK (hints BETWEEN 0 AND 30),
  score       INTEGER NOT NULL CHECK (score BETWEEN 0 AND 2000),
  revealed    INTEGER NOT NULL CHECK (revealed IN (0, 1)),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (site, problem_id, client_id)
);

CREATE TABLE ratings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  site        TEXT    NOT NULL CHECK (site IN ('onepot', 'namerxn')),
  problem_id  TEXT    NOT NULL CHECK (length(problem_id) BETWEEN 1 AND 120),
  client_id   TEXT    NOT NULL CHECK (length(client_id) = 36),
  stars       INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  remark      TEXT    CHECK (remark IS NULL OR length(remark) <= 200),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (site, problem_id, client_id)
);
CREATE INDEX ratings_site_created ON ratings (site, created_at);

-- Difficulty questions, asked after a problem is finished. Reagent lists are JSON arrays of text.
CREATE TABLE difficulty_answers (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  site             TEXT    NOT NULL CHECK (site IN ('onepot', 'namerxn')),
  problem_id       TEXT    NOT NULL CHECK (length(problem_id) BETWEEN 1 AND 120),
  client_id        TEXT    NOT NULL CHECK (length(client_id) = 36),
  seen             TEXT    NOT NULL CHECK (seen IN ('undergraduate', 'graduate', 'papers', 'never')),
  hardest_step     INTEGER CHECK (hardest_step IS NULL OR hardest_step BETWEEN 1 AND 20),
  known_reagents   TEXT    NOT NULL DEFAULT '[]'
                   CHECK (json_valid(known_reagents) AND json_type(known_reagents) = 'array' AND json_array_length(known_reagents) <= 6),
  unknown_reagents TEXT    NOT NULL DEFAULT '[]'
                   CHECK (json_valid(unknown_reagents) AND json_type(unknown_reagents) = 'array' AND json_array_length(unknown_reagents) <= 6),
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (site, problem_id, client_id)
);
