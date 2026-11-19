-- 2026-11-19: background data, nothing shown to visitors (ML_PLAN.md, "Assessment of the collected data").
-- (0004 is reserved for mech_entries on branch claude/beautiful-pasteur-7tg1k3; migrations apply by name, so either
-- order works.)
-- results: seconds = time from opening the problem to finishing; day_offset = days between the problem's set date and
--   the day it was finished (0 = solved on its own day).
-- views: one row per site, problem and visitor, when the problem is first displayed (attempts, completion rate).
-- progress: one row per site, problem and visitor, overwritten with the latest state when the visitor leaves the page
--   or switches problem (data from visitors who do not finish).

ALTER TABLE results ADD COLUMN seconds INTEGER CHECK (seconds IS NULL OR seconds BETWEEN 0 AND 864000);
ALTER TABLE results ADD COLUMN day_offset INTEGER CHECK (day_offset IS NULL OR day_offset BETWEEN 0 AND 3650);

CREATE TABLE views (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  site        TEXT    NOT NULL CHECK (site IN ('onepot', 'namerxn')),
  problem_id  TEXT    NOT NULL CHECK (length(problem_id) BETWEEN 1 AND 120),
  client_id   TEXT    NOT NULL CHECK (length(client_id) = 36),
  day_offset  INTEGER CHECK (day_offset IS NULL OR day_offset BETWEEN 0 AND 3650),
  user_level  TEXT    CHECK (user_level IS NULL OR user_level IN ('undergraduate', 'graduate', 'postgraduate')),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (site, problem_id, client_id)
);

CREATE TABLE progress (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  site        TEXT    NOT NULL CHECK (site IN ('onepot', 'namerxn')),
  problem_id  TEXT    NOT NULL CHECK (length(problem_id) BETWEEN 1 AND 120),
  client_id   TEXT    NOT NULL CHECK (length(client_id) = 36),
  found       INTEGER NOT NULL CHECK (found BETWEEN 0 AND 100),
  total       INTEGER NOT NULL CHECK (total BETWEEN 0 AND 100),
  checks      INTEGER NOT NULL CHECK (checks BETWEEN 0 AND 999),
  hints       INTEGER NOT NULL CHECK (hints BETWEEN 0 AND 30),
  seconds     INTEGER CHECK (seconds IS NULL OR seconds BETWEEN 0 AND 864000),
  solved      INTEGER NOT NULL CHECK (solved IN (0, 1)),
  revealed    INTEGER NOT NULL CHECK (revealed IN (0, 1)),
  named       INTEGER CHECK (named IS NULL OR named IN (0, 1)),
  day_offset  INTEGER CHECK (day_offset IS NULL OR day_offset BETWEEN 0 AND 3650),
  score_rule  INTEGER NOT NULL DEFAULT 2 CHECK (score_rule IN (1, 2)),
  user_level  TEXT    CHECK (user_level IS NULL OR user_level IN ('undergraduate', 'graduate', 'postgraduate')),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (site, problem_id, client_id)
);
