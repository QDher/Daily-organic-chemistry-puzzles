-- 2026-11-11: structures checked on the pages (one row per site, problem, visitor and distinct structure).
-- key: comparison key of the drawn species (src/chemkey.js: InChI without stereo, protonation and counterions);
-- smiles: the drawing as RDKit SMILES; verdict: what the page answered; step / intermediate: numbers of the matched
-- intermediate (verdict 'intermediate'); hints: hints shown at that time; seconds: since the problem was opened.
-- Used for wrong-answer clusters (Tier A additions of alternative drawings, ML_PLAN.md) and per-intermediate statistics.

CREATE TABLE checks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  site          TEXT    NOT NULL CHECK (site IN ('onepot', 'namerxn')),
  problem_id    TEXT    NOT NULL CHECK (length(problem_id) BETWEEN 1 AND 120),
  client_id     TEXT    NOT NULL CHECK (length(client_id) = 36),
  key           TEXT    NOT NULL CHECK (length(key) BETWEEN 1 AND 2000),
  smiles        TEXT    NOT NULL CHECK (length(smiles) BETWEEN 1 AND 1000),
  verdict       TEXT    NOT NULL CHECK (verdict IN ('product', 'intermediate', 'substrate', 'none')),
  step          INTEGER CHECK (step IS NULL OR step BETWEEN 1 AND 20),
  intermediate  INTEGER CHECK (intermediate IS NULL OR intermediate BETWEEN 1 AND 50),
  hints         INTEGER NOT NULL CHECK (hints BETWEEN 0 AND 30),
  seconds       INTEGER CHECK (seconds IS NULL OR seconds BETWEEN 0 AND 864000),
  user_level    TEXT    CHECK (user_level IS NULL OR user_level IN ('undergraduate', 'graduate', 'postgraduate')),
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (site, problem_id, client_id, key)
);
CREATE INDEX checks_site_problem ON checks (site, problem_id, verdict);
