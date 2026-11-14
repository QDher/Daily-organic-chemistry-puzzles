# Handoff: feedback loop, ML plan, Tier A (session of 2026-11-11 to 2026-11-14)

Session `session_01HwgXneozBwLM6xUt61yVKB`, branch `claude/wonderful-ride-a02pmf` in both repositories
(QDher/Daily-organic-chemistry-puzzles = One-Pot, QDher/Daily-name-reaction-puzzle = Name Reaction Daily).

## 1. Scope

- Plan for using visitor feedback and machine learning to improve problem selection and quality (`ML_PLAN.md`,
  One-Pot repository, covers both sites).
- Page changes on both sites: scoring rule, visitor level question, difficulty vote (One-Pot), logging of structures
  checked.
- Feedback Worker (Cloudflare Workers + D1, `feedback-worker/` in the One-Pot repository): new fields and tables.
- Tier A automatic changes (`src/tier_a.py`, step 3c of both scheduled-task prompts).
- Prompt updates of both scheduled tasks; removal of the Supabase import; documentation (curly-arrow plan, HPC note).

## 2. Decisions (user)

| Date | Decision |
|---|---|
| 2026-11-11 | Feedback trains the models; the models, once activated by the user, influence selection. The former rule "feedback never changes anything" is replaced accordingly. |
| 2026-11-11 | Objective: One-Pot = difficulty matched to the level + high rating; Name Reaction Daily = quality only (errors, clarity, relevance) + rating, no difficulty aspect. Completion rate is secondary, used only if below 10 % repeatedly across problems. |
| 2026-11-11 | No periodic maintenance task: work starts when enough (new) data exists. |
| 2026-11-11 | Changes needing approval go through GitHub pull requests merged by the user. |
| 2026-11-11 | No comparison question between the three problems of a set. |
| 2026-11-11 | Correct intermediates are not counted in the score (product, substrate and wrong structures still count). |
| 2026-11-11 | Level question (undergraduate / graduate / postgraduate) before the first answer; stored, never shown, not used in the score. |
| 2026-11-11 | One-click difficulty vote (too easy / about right / too hard), One-Pot only. |
| 2026-11-11 | Tier A runs without approval; N = 3 changes per run. |
| 2026-11-11 | RXNMapper and forward-prediction models (Molecular Transformer, Chemformer) kept as optional tools, used when relevant. |
| 2026-11-11 | Curly-arrow mechanisms recorded as future development (goals, conventions, crowd data, model); arrow-end rule: start = available lone pair, end = vacant orbital; transition metals need own rules. |
| 2026-11-11 | Supabase import removed; Supabase project may be deleted by the user. |
| 2026-11-11 | A simpler task architecture (prompt in repo only, CI build) was proposed and declined: architecture unchanged. |
| 2026-11-11 | HPC (Nibi) note added to the plan: not needed now; later for training and batch jobs. |

## 3. Current state

| Component | State | Verified |
|---|---|---|
| Worker migrations 0002 (user_level, score_rule, difficulty_votes) and 0003 (checks), read function `check_clusters`, votes in `difficulty_summary` | Live | Worker workflow runs for #1 and #6 succeeded; read functions answer; local tests 11/11 after #6 |
| One-Pot page: scoring rule 2, level question, difficulty vote, check logging | Live | Headless browser with mocked Worker; live site serves the code; live data show votes (13 by 2026-11-14) and check rows |
| Name Reaction page: scoring rule 2, level question (structure and name answers), check logging | Live | Headless browser with mocked Worker; live data show check rows |
| `src/tier_a.py` (same file in both repositories) | Live | Tests on copies of the data (resonance forms added; C–C proton shift, H-count change, protonation variant, test row, < 3 visitors skipped; validator ALL OK). Real runs 2026-11-11/12/13: step 3c executed, nothing applied (no cluster with 3 visitors yet) |
| Scheduled-task prompts (step 3b scoring rule / votes / test rows / feedback policy; step 3c Tier A) | Live since 2026-11-11 | Stored prompt compared character by character with `TASK_PROMPT.md` after update; `TASK_PROMPT.md` unchanged on `main` since; run log entries contain `tierA` |
| `ML_PLAN.md` (plan, tiers, models, optional tools, curly-arrow plan, HPC note) | On `main` | Documentation |
| Supabase | Import removed from repository | All Supabase rows found in D1 (ratings row by row; results and difficulty answers per problem). Not verified: deletion of the project and of the GitHub secret (user actions) |
| Selection model, feedback statistics script, views table, keyed per-row export, pull-request step in scheduled runs | Not built | — |

## 4. Open items and items waiting for the user

- User: delete the GitHub secret `SUPABASE_SECRET_KEY` and the Supabase project `gevbctklqelyumhynfnq` (check first that it holds nothing else).
- Proposals in `data/feedback_log.json` (One-Pot: 7 proposed observations) wait for user decisions; none applied.
- Not built (Phase 0/1 of `ML_PLAN.md`): `views` table (completion rate), problem `revision` and `ruleVersion` columns, keyed per-row export, `src/feedback_stats.py`, remark labels.
- Pull-request step from the scheduled runs: needs GitHub write access from scheduled sessions; not verified.
- Finding: 17 resonance forms of published intermediates are rejected by `src/chemkey.js` (mostly α-amino carbocations for iminium ions); accepting the class would be a Tier B change (user decision).
- GitHub plugin connector blocked by the network policy (`api.githubcopilot.com`); the session's built-in GitHub tools work.

## 5. Files and commits (merge commits on `main`)

One-Pot repository:
- #1 `9fa40e6` (Worker: `feedback-worker/migrations/0002_*.sql`, `0003_checks.sql`, `src/index.js`, `src/rows.js`, `test/test.js`, `README.md`).
- #2 `67ecb13` (`src/index.src.html`, `index.html`, `src/tier_a.py`, `TASK_PROMPT.md`, `ML_PLAN.md`, `CLAUDE.md`, `src/PIPELINE.md`).
- #3 `44c69f6` (`TASK_PROMPT.md` backup line).
- #5 `d835d5a` (`ML_PLAN.md` curly-arrow plan, `CLAUDE.md` pointer); issue #4 (curly-arrow future development).
- #6 `c4c2dd1` (removal of `feedback-worker/tools/import_supabase.js`, import step in `.github/workflows/feedback-worker.yml`, tests, README, `.gitignore`).
- #7 `3c7061a` (`ML_PLAN.md` HPC note).

Name Reaction Daily repository:
- #1 `ba8de99` (`src/index.src.html`, `index.html`, `src/tier_a.py`, `TASK_PROMPT.md`, `CLAUDE.md`).
- #2 `7e0b3af` (`TASK_PROMPT.md` backup line).

Scheduled tasks updated: `trig_01Hcu3iDawxUzV2mvz3jy9qf` (One-Pot), `trig_01Ke7KmM7zYWFMFeXDzg5bHT` (Name Reaction Daily), 2026-11-11.

## 6. Interfaces other sessions must check

- Scheduled-task prompts: any later prompt change must keep step 3b (scoring rule, votes, test rows, feedback policy) and step 3c (Tier A, at most 3 per run), and follow the convention: update the task and `TASK_PROMPT.md` with identical text. Name Reaction Daily has other recent work on `main` (catalogue, selection script, "draft of the catalogue steps for the scheduled prompt", merges #3 to #6 of that repository) not covered by this session; its prompt changes must be merged with this session's text, not replace it.
- Worker API: new optional fields (`user_level`, `score_rule`), tables `difficulty_votes` and `checks` (max 200 rows per visitor and problem), read function `check_clusters` (`p_min` ≥ 2). `user_level` and `score_rule` are never returned by public read functions. Older pages remain compatible.
- Scores: `score_rule` 1 (old) and 2 (new) must not be compared; public summaries mix both for problems published before 2026-11-12.
- Browser storage shared by both sites (same origin): `puzzles:level`, `puzzles:client`; per-problem state keys `onepot:<id>` / `namerxn:<id>` now hold `rule`, `t0`, `logged`.
- `src/tier_a.py` must stay identical in both repositories; it only appends forms (progress positions and hints unchanged).
- `ML_PLAN.md` is the single plan file for both sites (One-Pot repository); the Name Reaction `CLAUDE.md` points to it.

## 7. Next steps (priority order)

1. User: delete the Supabase secret and project.
2. Build Phase 0 remainder: `views` table and page call, `revision` / `ruleVersion`, keyed per-row export (needed by any model).
3. `src/feedback_stats.py` with fixed statistics and remark labels; step 3b reads it (prompt change: task and `TASK_PROMPT.md`).
4. Decide on the pending proposals in the One-Pot feedback log (user).
5. Difficulty model (One-Pot) and quality model (Name Reaction Daily) in shadow mode once the start conditions in `ML_PLAN.md` are met.
6. Pull-request step for Tier B proposals from the scheduled runs (verify GitHub write access first).
7. Later: curly-arrow interpreter (issue #4), then HPC training as described in the plan.
