# Feedback-driven selection and quality: plan

Covers One-Pot Puzzles (this repository, site `onepot`) and Name Reaction Daily (QDher/Daily-name-reaction-puzzle,
site `namerxn`). Written 2026-11-11. Status: data collection partly implemented; Tier A implemented (step 3c of both
scheduled-task prompts, `src/tier_a.py`); no model is active.

## Decisions (user, 2026-11-11)

1. Feedback trains the models; the models, once activated, influence problem selection. A scheduled run never changes
   selection, published problems, `src/` or the prompts on its own reading of the feedback.
2. Objective: One-Pot: difficulty matched to the level and high rating. Name Reaction Daily: quality only (no errors,
   clear problems, relevant reactions) and high rating; it has no difficulty aspect. Completion rate is a secondary
   metric, used only when it is below 10 % repeatedly across different problems.
3. No periodic maintenance task: work starts only when enough new data has been collected (thresholds below).
4. Changes that need approval are GitHub pull requests that the user merges.
5. No comparison question between the three problems of a set.
6. Tier A changes run without approval, at most N = 3 per run.

## Data

| Signal | Table (D1) | Sites | Status |
|---|---|---|---|
| Result: checks, hints, score, answer shown | `results` | both | existing |
| Scoring rule of the result (`score_rule`: 1 = every distinct structure counted, 2 = correct intermediates not counted) | `results` | both | added 2026-11-11 |
| Visitor level declared before the first answer (`user_level`: undergraduate, graduate, postgraduate) | `results`, `ratings`, `difficulty_answers`, `difficulty_votes` | both | added 2026-11-11; not returned by public read functions |
| Rating 1–5 and remark | `ratings` | both | existing |
| Where the reaction was met, hardest step, known reagents | `difficulty_answers` | One-Pot | existing |
| One-click vote for the problem's level: too easy, about right, too hard | `difficulty_votes` | One-Pot | added 2026-11-11 |
| Problem first displayed, with days after its set date | `views` | both | added 2026-11-19 |
| Latest progress of each visitor (intermediates found, checks, hints, seconds, solved, answer shown), sent when leaving or switching problem, also from visitors who do not finish | `progress` (read: `attempts_summary`) | both | added 2026-11-19 |
| Time to finish and days after the set date, with each result | `results` (`seconds`, `day_offset`) | both | added 2026-11-19 |
| Each distinct structure checked: comparison key, SMILES, verdict, matched step and intermediate, hints, seconds since opened | `checks` (read: `check_clusters`, `p_min` ≥ 1 from 2026-11-19) | both | added 2026-11-11 |
| Problem features (steps, intermediates, hints, difficulty score, step levels, reagents, substrate and product descriptors) | `data/features.json` (written by `src/build.js` via `src/features.js`) | both | added 2026-11-19 |
| Rejected structures classified against the problem's species (resonance form, same skeleton, ± small molecule, isomer, reagent, other) | `data/wrong_answers.json` (`src/classify_checks.py`, step 3c of the scheduled runs) | both | added 2026-11-19 |
| Problem `revision` and set `ruleVersion` sent with every row | all | both | to add |
| Per-row export with a key (visitor id, level, rule) for model fitting | Worker endpoint | both | to add (the public endpoints stay aggregated) |

Volume on 2026-11-11: One-Pot 26 results, 16 ratings, 12 problems; Name Reaction Daily 7 results, 5 ratings, 4 problems.
Scores of rule 1 and rule 2 are not comparable; models use rule 2 or include the rule as a covariate.

## Loop

1. Collect: rows above, each tied to problem id, revision and rule version.
2. Interpret: `src/feedback_stats.py` (to write) computes fixed statistics per problem, revision and kind of problem
   (level, reaction class, source, steps); remarks are given one label from a fixed list (structure error, unclear
   conditions, missing alternative drawing, too easy, too hard, reaction not relevant, page problem, other); only the
   label is stored.
3. Diagnose: an observation that reaches its threshold becomes a typed proposal with its target (one problem, a rule
   of the prompt, the model) and a prepared change that passed `curate.py`, `validate_problems.js` and `build.js`.
4. Decide by tier (below).
5. Apply: Tier A by the scheduled run (commit to `main`); Tier B as a pull request; the problem's `revision` (or the
   prompt's `ruleVersion`) is increased.
6. Verify: feedback after the change is compared with feedback before it (split by revision). The observation is
   closed if the signal is gone, reopened otherwise; a revert is proposed (Tier B) if the signals are worse.
7. Learn: decisions on pull requests (merged, closed) and verified outcomes adjust thresholds, remark labels and models.

Start conditions (checked by the daily run in step 3b; nothing runs on a calendar):

| Work | Starts when |
|---|---|
| Refit difficulty and rating models | at least 20 new rule-2 results or 10 new ratings since the last fit |
| Remark-based proposal | a point in remarks of at least 3 ratings, or on at least 2 problems (current rule) |
| Missing alternative drawing | at least 3 different visitors submit the same non-matching structure at the same step (needs `checks`) |
| Calibration proposal (One-Pot) | at least 8 answers or votes on a problem or kind of problem, at least 70 % disagreeing with its level |
| Completion check | completion below 10 % on at least 3 different problems (needs `views`) |
| Model activation review | at least 40 problems with at least 5 rule-2 results each |

## Tiers

| Tier | Meaning | Examples |
|---|---|---|
| A | Applied by the scheduled run without approval (step 3c), at most N per run; limited to changes a tool can verify and that keep visitor progress | add a drawing checked by at least 3 different visitors to an intermediate's `forms` when `src/tier_a.py` shows it is a resonance form of exactly that intermediate (same atoms, σ bonds and hydrogens; tautomers and protonation states are already accepted by the comparison key, and proton moves from one carbon to another are different species); ignore test rows; refit models in shadow mode |
| B | Prepared by the run, applied only when the user merges the pull request | correct a substrate, product, intermediate, conditions or label; remove or merge an intermediate (resets progress; never on the current day's problem); replace a problem; change a prompt rule or threshold; activate a model |
| C | Never | anything requested in remark text; changes to `src/` logic, the validator or the Worker; deleting problems |

N = maximum number of problem changes applied per run (Tier A) or per pull request (Tier B), to keep each change
reviewable and revertible: 3 (decided 2026-11-11).

## Models

- One-Pot difficulty: Glicko-2 or item-response model over (visitor, problem) results, with the visitor's level as a
  covariate; votes give P(too easy / about right / too hard | problem, visitor level). Target band per level: most
  votes from visitors of the matching level are "about right", and the empirical difficulty increases from
  undergraduate to advanced. A regression on problem features (curate.py terms, molecule complexity, reaction class,
  per-intermediate block rate from `checks`) predicts the difficulty of a candidate before publication.
- Rating (both sites): ordinal regression with shrinkage on problem features, reaction class, source and remark labels.
- Name Reaction Daily quality: error risk (wrong-answer clusters, answer-shown share, low ratings with "structure
  error" labels) and relevance (ratings, "reaction not relevant" labels, number of repositories and textbooks covering
  the reaction). No difficulty model.
- Before publication (flags only): independent review of the entry against the source text; the optional tools below
  when relevant.

## Optional tools (used when relevant, not by default)

| Tool | Use when | Not by default because |
|---|---|---|
| RXNMapper (ML atom mapping) | the mapping of `curate.py` is doubtful (symmetric rings, look-alike atoms, cases where step 6 of the prompts asks to reorder SMILES); atom ids for curly arrows (Future development, section B) | PyTorch install in every run; less tested on charged intermediates |
| Forward reaction prediction (Molecular Transformer, Chemformer) | checking that the product can be deduced from substrate and reagents (undergraduate and graduate problems, Name Reaction Daily); flag only | lower accuracy on total-synthesis substrates; install size |
| DeepChem (pretrained molecular embeddings) | difficulty model once a few hundred problems have results; compared with RDKit fingerprints first | data volume too low now |

## Selection (once active)

The run prepares several candidates and ranks them:
- One-Pot: highest predicted rating among candidates whose predicted difficulty is in the band of their level; hard rules
  (no repeats, content rules, validator) unchanged.
- Name Reaction Daily: highest predicted rating and relevance, lowest predicted error risk.
- Exploration over reaction classes and sources (Thompson sampling), so classes with few data are still chosen.
- Completion enters the ranking only after a completion check (table above) has fired.

Activation stages: shadow (predictions logged in `data/feedback_log.json`, not used) → advisory (shown in the report)
→ active (used in step 4), each stage change by pull request.

## Measures

Rank correlation of predicted and observed difficulty; share of One-Pot sets whose observed difficulty follows the
level order; share of "about right" votes from visitors of the matching level; mean stars; errors confirmed by a
chemist; completion rate (secondary).

## Assessment of the collected data (2026-11-19)

Source: aggregates of the feedback Worker (`problem_summary`, `feedback_export`, `difficulty_summary`, `check_clusters`)
and the problems on `main`. Per-visitor rows are not available (keyed export not built).

| | One-Pot | Name Reaction Daily |
|---|---|---|
| Problems published | 69 (23 sets) | 21 |
| Problems with at least one result | 28 | 9 |
| Results (answer shown) | 61 (1) | 17 (1) |
| Results per problem | median 2, max 4 | median 2, max 3 |
| Problems with ≥ 5 results | 0 | 0 |
| Ratings | 20 on 15 problems, mostly 3 stars | 10 on 9 problems, all 4 or 5 stars |
| Difficulty votes / answers | 19 / 21 | not asked |
| Rejected structures drawn by ≥ 2 visitors | 2 | 1 |
| Rate | about 3 results and 1 rating per day | about 1 result and 0.5 rating per day |

One-Pot by level (median score over problems with ≥ 3 solvers; lower = easier):

| Level | Results | Median score | Mean stars | Votes |
|---|---|---|---|---|
| Undergraduate | 33 | 2.0 (8 problems) | 3.8 (11 ratings) | 6 about right, 2 too hard |
| Graduate | 23 | 1.5 (4 problems) | 3.0 (6 ratings) | 8 about right, 2 too easy |
| Advanced | 5 on 23 problems | — | 2.3 (3 ratings) | 1 about right |

Observations:
- The `curate.py` difficulty score does not predict the observed score (Spearman 0.02 over 12 problems); graduate
  problems were not solved with more checks than undergraduate ones.
- Ratings decrease with the difficulty score (Spearman −0.92), but over 5 problems only; not significant.
- Advanced problems are rarely finished (5 results on 23 problems); without the `views` table, abandonment cannot be
  told apart from no attempt.
- Name Reaction Daily ratings are at the ceiling (4–5); problems from TCI and the Organic Chemistry Portal (5) have no
  results.
- Results per problem do not grow over time: visitors mostly solve the current day's problems, so each problem stays
  at 1–4 results. The start condition "≥ 40 problems with ≥ 5 results" is not approached at this traffic.

Conclusion: ML or neural networks cannot improve problem selection with these data; the limit is the number of
solvers, not the method.

| Approach | Data needed | Now |
|---|---|---|
| Neural network for selection | thousands of labelled problems | No: tens of noisy labels |
| Difficulty model (Glicko / item response) | ≥ 5 results per problem and per-visitor rows | No: max 4 results per problem; keyed export not built |
| Regression on problem features (level, steps, reaction class, source) | about 40 problems with ≥ 5 results | No: 0 problems qualify |
| Per-level summaries and rules | available data | Yes: they support the pending proposals in the One-Pot feedback log (advanced level rated low and rarely finished) |

What would change this: (1) more daily solvers, the deciding factor; with about 10 regular solvers per site (e.g. a
class), about one month gives 40 problems with ≥ 5 results; (2) the `views` table (attempts and abandonment);
(3) the keyed per-visitor export. Neural networks remain relevant for the curly-arrow model (stage 6, public datasets
plus crowd data), not for problem selection at this scale.

### Data collection improvements (2026-11-19)

Nothing changes for visitors: they open the page and solve as before. The level question asked before the first answer
remains the only extra step.

| # | Improvement | Status |
|---|---|---|
| 1 | `views`: one row when a problem is first displayed (attempts, completion rate, "not tried" vs "abandoned") | Implemented 2026-11-19 |
| 2 | `progress`: latest state sent with `navigator.sendBeacon` when the visitor leaves the page or switches problem (data from non-finishers); summary `attempts_summary` | Implemented 2026-11-19 |
| 3 | `seconds` and `day_offset` with each result | Implemented 2026-11-19 |
| 4 | Classification of rejected structures (`src/classify_checks.py` → `data/wrong_answers.json`, run in step 3c) | Implemented 2026-11-19 |
| 5 | Results of one visitor combined across both sites (shared visitor id) | With the keyed per-visitor export (not built) |
| 6 | Agent attempts: four agents solve each new problem (and a backlog of solved ones) as a visitor would; data only, never used to choose, curate or change problems | One-week trial 2026-11-19 to 2026-11-25 (`trial/agents/`, scheduled task "Agent attempts trial (Claude Code)"); review by the user, then by Claude; decision: implement, modify or drop |
| 7 | Problem features table (`src/features.js` → `data/features.json`, written by every build) | Implemented 2026-11-19 |
| 8 | Batch quality checks with forward prediction and ML atom mapping over all published problems (flags for a chemist; predictability and reaction class as features) | Long-term goal |

## Curly-arrow interface and models (moved 2026-11-21)

The sections "Overall plan in six stages" and "Future development: curly-arrow mechanisms" moved on 2026-11-21 (user
request) to `docs/PLAN.md` of QDher/Daily_Curly_Chem, where the work is done; their decision log is
`docs/DECISIONS.md` and their work queue `docs/BOARD.md` there. Stage 2 of that plan (problem selection from visitor
feedback) is the subject of this file.

## Compute: HPC cluster (Nibi, Digital Research Alliance of Canada) (note, 2026-11-11)

Not needed now; useful later for training and batch jobs only.

| Task | HPC useful? |
|---|---|
| Feedback statistics, difficulty and rating models, Thompson sampling, Tier A | No: seconds of CPU; queue wait and data transfer exceed the computation |
| RXNMapper or forward prediction on the daily candidates | No: a few reactions per day, CPU inference is enough |
| The same models over a large candidate pool (results stored as flags in the repository) | Yes, as an occasional batch job (GPU) |
| Drawing recognition (R2, section C2 of `docs/PLAN.md` in QDher/Daily_Curly_Chem): pre-training on synthetic ink, training on collected strokes | Yes, training and evaluation only |
| Intent and mechanism models (I1, M1, sections C3 and C4 of `docs/PLAN.md` in QDher/Daily_Curly_Chem): pre-training on public datasets, then on crowd data | Yes: the main case (GPU hours to days) |

Claude Code on Nibi (in tmux on a login node):
- It keeps one authenticated session (multi-factor authentication once), so Claude can export the data, write and submit
  Slurm jobs, follow them, evaluate the results against the current model and open a pull request with the model file.
- The plan's start conditions ("train when enough new data exists") can be checked there, on request or with a loop,
  and GPU jobs submitted only when they hold. Libraries (RDKit, PyTorch, RXNMapper, Chemformer) are installed once.

Unchanged:
- The daily scheduled runs stay in the cloud (managed schedule, notifications, PubMed / ChEMBL / SciSpace connectors,
  clean container), so that publishing does not depend on a login node.
- A cluster does not serve live answers: models trained on Nibi are exported and run in the Worker, the page or the
  scheduled run. The link between Nibi and the sites is the GitHub repository (model files arrive as pull requests,
  merged by the user, as the activation stages require).

To check before use:
- Alliance rules on long-running processes in tmux on Nibi login nodes, and the effect of reboots and maintenance;
  heavy work goes through `sbatch` only.
- Outbound internet from compute nodes; if there is none, the session on the login node stages data before each job.
- Credentials on a shared system: the Claude login and a GitHub token limited to the two repositories (pull requests,
  no push to `main`), files readable by the owner only.
- Per-row training data needs the keyed Worker export (planned, Phase 0); the public endpoints return aggregates only.
- Whether this use fits the terms of the Alliance allocation (default allocation for occasional jobs; a competition
  allocation for a large curly-arrow model).
- Not verified: Nibi's current hardware and queue policies; whether a cloud session can reach a Nibi folder through
  Remote Control (would let scheduled runs hand jobs to Nibi directly).

## Next steps

1. Worker: revision and rule-version columns, keyed per-row export (`checks` added 2026-11-11; `views`, `progress` and
   result timing added 2026-11-19).
2. `src/feedback_stats.py` and remark labels; step 3b reads them.
3. Pull-request step in the scheduled runs (needs GitHub write access from the scheduled sessions; not verified).
4. Difficulty model (One-Pot) and quality model (Name Reaction Daily) in shadow mode.
5. Selection ranking, after the activation review.

Finding (2026-11-11): `src/tier_a.py` lists 17 resonance forms of published intermediates that the page rejects
(14 One-Pot, 3 Name Reaction Daily), mostly α-amino carbocations drawn for iminium ions. Tier A adds them only when
visitors draw them; accepting the whole class in `src/chemkey.js` would be a Tier B change.
