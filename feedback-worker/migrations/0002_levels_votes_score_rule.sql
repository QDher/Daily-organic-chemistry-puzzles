-- 2026-11-11: visitor level, scoring rule of each result, and the one-click difficulty vote.
-- user_level: level the visitor declared before their first check ('undergraduate', 'graduate', 'postgraduate');
--   NULL for rows sent before this change. Not returned by any read function; it does not change the score.
-- score_rule: 1 = every distinct structure checked counted (rows before this change, and problems started before it);
--   2 = correct intermediates not counted (product, substrate and wrong structures still count).
-- difficulty_votes: "too easy / about right / too hard" for the problem's level, one per site, problem and visitor.

ALTER TABLE results ADD COLUMN user_level TEXT CHECK (user_level IS NULL OR user_level IN ('undergraduate', 'graduate', 'postgraduate'));
ALTER TABLE results ADD COLUMN score_rule INTEGER NOT NULL DEFAULT 1 CHECK (score_rule IN (1, 2));
ALTER TABLE ratings ADD COLUMN user_level TEXT CHECK (user_level IS NULL OR user_level IN ('undergraduate', 'graduate', 'postgraduate'));
ALTER TABLE difficulty_answers ADD COLUMN user_level TEXT CHECK (user_level IS NULL OR user_level IN ('undergraduate', 'graduate', 'postgraduate'));

CREATE TABLE difficulty_votes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  site        TEXT    NOT NULL CHECK (site IN ('onepot', 'namerxn')),
  problem_id  TEXT    NOT NULL CHECK (length(problem_id) BETWEEN 1 AND 120),
  client_id   TEXT    NOT NULL CHECK (length(client_id) = 36),
  vote        TEXT    NOT NULL CHECK (vote IN ('too_easy', 'about_right', 'too_hard')),
  user_level  TEXT    CHECK (user_level IS NULL OR user_level IN ('undergraduate', 'graduate', 'postgraduate')),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (site, problem_id, client_id)
);
