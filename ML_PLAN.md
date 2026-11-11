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
| Problem opened (completion rate) | `views` | both | to add |
| Each distinct structure checked: comparison key, SMILES, verdict, matched step and intermediate, hints, seconds since opened | `checks` (read: `check_clusters`) | both | added 2026-11-11 |
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
| RXNMapper (ML atom mapping) | the mapping of `curate.py` is doubtful (symmetric rings, look-alike atoms, cases where step 6 of the prompts asks to reorder SMILES); mapping atoms for curly arrows (Future development, below) | PyTorch install in every run; less tested on charged intermediates |
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

## Future development: curly-arrow mechanisms (plan, 2026-11-11)

Tracked on GitHub: https://github.com/QDher/Daily-organic-chemistry-puzzles/issues/4. Not scheduled.

### A. Goals

1. A user draws curly arrows on a structure; Claude interprets them correctly and gives the resulting structure
   (intermediate or product).
2. Claude draws a mechanism from and to a molecule as curly arrows (forward from a substrate, backward from a target).

### B. Plan

1. Drawing to structure, without a Ketcher-type sketcher: the user draws the structure freehand (mouse or stylus) and
   Claude converts the drawing into a readable structure (SMILES with atom positions). The recognized structure is
   redrawn cleanly for the user to confirm or correct before any arrow is drawn.
   - The Claude API accepts images and can return a fixed JSON shape (structured outputs). Calls go through the
     feedback Worker, which keeps the API key as a Worker secret; the page never holds it. Each call has a cost, so the
     Worker needs a limit per visitor and per day.
   - Open recognition models for drawn structures (e.g. DECIMER, MolScribe) are an alternative or a cross-check; their
     accuracy on hand drawings, like Claude's, is to be measured on a test set before use.
2. Arrows drawn by the user: on the confirmed structure, the user draws one or more arrows from bonds and atoms with
   the pointer (mouse, touch or stylus), confirms the entry, and then Claude applies the arrows.
   - Arrows are drawn over the clean rendering, whose atom and bond positions are known: each arrow end is snapped to
     the nearest atom, bond or lone-pair position, so an arrow is stored as data (source, sink), not as pixels. The
     direction of the stroke gives source → sink.
3. Conventions (common organic chemistry practice):
   - Hydrogens on carbon are implicit, and an arrow is never interpreted as involving an implicit hydrogen; to move a
     C–H proton or hydride, the user draws that hydrogen.
   - Lone pairs are implicit: an arrow starting in empty space next to an atom that has a lone pair (O, N, S, halogen,
     anion, carbanion) uses one of that atom's lone pairs (e.g. next to an oxygen).
   - Arrow from a bond to one of its own atoms: heterolysis toward that atom. Arrow from a lone pair or a bond to
     another atom, or to the space between two atoms: a new bond (σ or π) to that atom. Each rule is written down and
     covered by tests before use; half-headed (radical) arrows come later.
4. Validation: the resulting structure is shown and the user accepts it or not. If not, Claude proposes another
   structure from the same arrows (another reading of an ambiguous arrow end), until the user accepts or stops.
   Accepted and rejected readings are both recorded.

Applying arrows to a structure is deterministic (bond orders, charges, lone pairs) and can run with RDKit in the page
or the Worker; every result is checked for valences, charge and electron count. Claude is needed for reading the
drawing (B1), for alternative readings (B4) and for goal A2.

### C. Crowd data and model

- Each confirmed (structure, arrows, result) entry, and each rejection, is stored anonymously in D1 with the visitor
  level.
- With enough checked data, a model is trained or fine-tuned to use curly arrows for mechanisms, reactivity,
  synthesis and retrosynthesis (arrows run backward from a target). Public datasets of elementary steps (e.g. PMechDB,
  mech-USPTO-31K; not reviewed here) can serve for pre-training and evaluation.
- Only entries that pass the deterministic checks and are confirmed by several users train the model; a held-out set
  measures it (share of steps whose predicted arrows give the correct next species).
- Claude is not retrained by these data: the model is a separate tool Claude can call, and the data also serve as
  examples and as a test set for the mechanisms Claude writes (goal A2 and the scheduled runs).

### Order and prerequisites

1. Arrow interpreter (deterministic, tested) and arrow data format; no ML.
2. Arrows drawn on the puzzle pages after the product is found, on the problem's own species (atom mapping from
   `curate.py`, RXNMapper when doubtful): first data, with known answers.
3. Freehand structure drawing read by Claude (B1) and alternative readings by Claude (B4): Claude API key as a Worker
   secret, cost limit.
4. Model training (C), once enough confirmed steps exist.

Open: who pays the API calls and the daily limit; whether the collected data are published, and under which licence.

## Next steps

1. Worker: `views`, revision and rule-version columns, keyed per-row export (`checks` added 2026-11-11).
2. `src/feedback_stats.py` and remark labels; step 3b reads them.
3. Pull-request step in the scheduled runs (needs GitHub write access from the scheduled sessions; not verified).
4. Difficulty model (One-Pot) and quality model (Name Reaction Daily) in shadow mode.
5. Selection ranking, after the activation review.

Finding (2026-11-11): `src/tier_a.py` lists 17 resonance forms of published intermediates that the page rejects
(14 One-Pot, 3 Name Reaction Daily), mostly α-amino carbocations drawn for iminium ions. Tier A adds them only when
visitors draw them; accepting the whole class in `src/chemkey.js` would be a Tier B change.
