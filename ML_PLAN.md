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

## Future development: curly-arrow mechanisms (plan, 2026-11-11; refined 2026-11-13)

Tracked on GitHub: https://github.com/QDher/Daily-organic-chemistry-puzzles/issues/4. Status: nothing built. First
milestone: a test run with a few users (section F) that decides whether the tool and its logging are ready for the
data collection phase.

### A. Goals

1. Intent model: a user draws curly arrows on a structure; a trained model converts them into the structure the user
   meant (intermediate or product), also when the arrows are imprecise or ambiguous.
2. Mechanism model: the AI draws the curly-arrow mechanism itself when given a substrate (with reagents) and a product.
3. Drawing recognition (required by 1 and 2): a hand-drawn structure (mouse or touch screen) is converted into a clean
   structure with a SMILES-based representation, as in chemistry viewers. Software-drawn and hand-drawn content are
   interchangeable on one canvas: hand-drawn arrows and additions act on a rendered structure, and a hand-drawn
   structure becomes a rendered one.
4. Later (section G): mechanisms drawn on 3D structures (ball-and-stick models optimized by molecular mechanics).

### B. One representation for all views

Goals 1 to 4 need the same data whatever the view (ink, clean 2D, 3D). A SMILES string alone loses atom positions and
atom identity, which arrows need; the stored object is therefore a scene, and SMILES is derived from it.

| Part | Content |
|---|---|
| Graph | atoms (stable id, element, charge, explicit H, radical; 2D coordinates; optional 3D coordinates), bonds (atom ids, order, stereo). Stored as a molfile or CXSMILES with coordinates; canonical SMILES and the comparison key (`src/chemkey.js`) are derived |
| Strokes | raw pointer input: points (x, y, time, pressure), pointer type (mouse, touch, pen), in scene coordinates |
| Arrows | source (atom lone pair, bond), sink (atom, bond, or new bond between two atoms), electrons (2; 1 later), id of the stroke it came from |
| Edits | what each structure stroke became: add bond, change bond order, set element or charge, delete; or "unresolved ink" |

Rules:
- Arrows refer to atom and bond ids, never to pixels, so one arrow can be shown and entered in any view.
- Ink and clean rendering are two views of one graph. A stroke drawn on a rendered structure is snapped to its atoms
  and merged into the graph; a fully hand-drawn structure is recognized, shown clean, and confirmed or corrected.
- Raw strokes are always kept next to the confirmed graph: these pairs are the training data of goal 3.
- Atom ids of a problem's species follow the atom mapping of `curate.py` (RXNMapper when doubtful), so the same atom
  keeps its id from substrate to product.

### C. Components

Four components. Each has a version without training (enough for the test run) and a trained version (needs the data
collection phase).

**C1. Arrow interpreter (deterministic, no ML).** Applies arrows to a graph: bond orders, charges, lone pairs; checks
valence, total charge and electron count. `src/arrows.js` (same file in both repositories, runs in the page and in
Node) with tests. Conventions:
- Hydrogens on carbon are implicit; an arrow never involves an implicit hydrogen. To move a C–H proton or hydride, the
  user draws that hydrogen.
- Lone pairs and vacant orbitals are implicit. An arrow end in empty space next to an atom attaches to that atom only
  if the atom can play the role: start = available valence lone pair (ether O, amine N, halide, anion); end = vacant
  valence orbital (BEt3, carbocation). An atom with a full octet accepts an arrow end only if another arrow of the same
  entry breaks one of its bonds (SN2, addition to C=O).
- Bond → one of its own atoms: heterolysis toward that atom. Lone pair or bond → another atom, or → the space between
  two atoms: new σ or π bond.
- Outside the first version: half-headed (radical) arrows, transition metals.

**C2. Drawing recognition (goal 3).** Input is strokes (order and timing known), not a picture, which is an easier
problem than image recognition.

| Version | Method | Needs |
|---|---|---|
| R0 (test run) | geometry: strokes cut at corners into segments = bonds; close endpoints merged = atoms; parallel close segments = double or triple bond; small strokes near a vertex = label, matched against templates (N, O, S, P, F, Cl, Br, I, H, B, Si, +, −) with a point-cloud recognizer; unrecognized label → the user picks the element. Structure, arrow and erase are explicit modes | no training, no API call; runs in the page |
| R1 (optional cross-check) | the ink as an image to the Claude API, fixed JSON output (graph), through the feedback Worker (API key as Worker secret, limit per visitor and day) | API cost; accuracy to be measured |
| R2 (after data collection) | model trained on (strokes, confirmed graph) pairs; pre-training on synthetic ink (published structures redrawn with jitter) and on open hand-drawn recognition work (DECIMER hand-drawn, ChemPix; not reviewed here); also learns stroke type (structure, arrow, label), which removes the modes | collected pairs; GPU (Nibi) |

In the modes of R0 every stroke carries its type, so the test run already yields labelled strokes for R2.

**C3. Intent model (goal 1).** Formulated as ranking, not generation, so that little data is needed:
1. Candidates: for each arrow end, the k nearest attachment points that pass the role rules of C1; all combinations
   are applied by C1; invalid results are dropped.
2. Ranking: I0 (test run) = fixed score (snapping distance, validity, fewest formal charges). I1 (trained) = learned
   ranker on features of the stroke (distances, curvature, start and end direction), of the graph (element, charge,
   hybridization at each end) and of the context (reagents, step); label = the reading the user accepted, or the
   problem's known intermediate.
3. The first-ranked structure is shown; on rejection the next one; accepted and rejected readings are recorded with
   their rank.
4. Repair (later): when no candidate is accepted (missing arrow, arrow drawn in the wrong direction), the model
   proposes the smallest change of the arrows that gives a valid structure; these cases are recorded by type from the
   test run on.

The intent model predicts what the user meant, not what is chemically correct. Correctness is judged separately,
against the problem's reference step; an entry that is read as intended but is wrong chemistry is kept as such (data
on common errors), never corrected silently.

**C4. Mechanism model (goal 2).**

| Version | Method |
|---|---|
| M0 (test run) | Claude writes each elementary step as arrows in the format of section B; C1 applies them; a step is accepted only if it gives the next species and the last one gives the product (comparison key). Repeated until every step passes. Produces the reference mechanisms of the test-run tasks; shown to testers, who mark each step correct, wrong or unclear |
| M1 (after data collection) | separate model: pre-trained on public elementary-step datasets (e.g. PMechDB, mech-USPTO-31K, FlowER; licences and content not reviewed here), fine-tuned on crowd-confirmed steps; measured on a held-out set (share of steps whose predicted arrows give the correct next species; share of complete mechanisms) |
| Use | Claude is not retrained. M1 is a tool Claude calls and a cross-check of M0; confirmed crowd steps also serve as retrieved examples for M0 and as its test set. Every output still passes C1 |

What the crowd data add over public datasets: accepted alternative depictions of one step, step granularity that users
expect, frequent wrong arrows per reaction class, and votes on the AI's own steps.

### D. Data recorded

One D1 table `mech_entries` (site key `mechpilot` during the test run), one row per confirmed or abandoned entry:
tester code or visitor id, level, pointer type and screen size, task and problem id, step, scene before (graph),
strokes, recognized graph and the corrections made, arrows as snapped, candidate readings with rank, reading accepted,
literal result, verdict against the reference, seconds, tool and rule versions. Votes on AI steps in `mech_votes`.
Remarks stay in D1 (never in the repository).

Training sets come from this table only through a replay: `src/mech_replay.js` re-runs recognition, snapping and C1
on the stored row and must reproduce the stored result. Rows that do not replay are excluded.

The label is the visitor's answer on the structure produced by their arrows (accepted or rejected, with the rank of
the reading), together with the problem's known intermediate. Only entries that pass C1 and are confirmed train a model; for I1 and M1, a step counts when at least 3 different
visitors gave the same result or it equals the reference.

### E. Order

| Phase | Content | ML |
|---|---|---|
| 1. Build | scene format, C1 with tests, canvas (pointer input, snapping, modes), R0, I0, reference mechanisms by M0 for the tasks, Worker table and replay script | none |
| 2. Test run | section F; report; decision by the user | none |
| 3. Data collection | optional arrow step on both daily pages after the product is found (the problem's own species: known answers); freehand input next to Ketcher, not instead of it; notice of what is recorded | none; R1 optional |
| 4. Training | R2, I1, M1 on Nibi, each compared with its untrained version on held-out data; activation by pull request (shadow → advisory → active, as for the selection models) | yes |

Start conditions for phase 4 (proposed, to be revised after the test run): R2 at least 2,000 confirmed drawings from
at least 50 visitors; I1 at least 1,000 confirmed entries with at least 150 where the first reading was rejected; M1
fine-tuning at least 500 distinct confirmed steps.

### F. Test run

Purpose: decide whether tool and logging are ready for phase 3. It is not meant to produce training data.

- Repository (decided 2026-11-13): QDher/Daily_Curly_Chem holds the test-run page (its own GitHub Pages site, opened
  with a tester code `?t=...`, not linked from the daily sites) and is the single source of the shared modules (scene
  format, C1, canvas, R0, I0, replay) with their tests. The daily pages, their problems and visitor progress are not
  changed during the test run.
- Worker: table and site key `mechpilot` are added to `feedback-worker/` of this repository by a migration (one
  database and one export for test run and phase 3).
- Deployment (phase 3): a versioned bundle from QDher/Daily_Curly_Chem is copied into `src/` of both site
  repositories (identical files, as `src/chemkey.js`) and added by `src/build.js` as an optional step after the
  product is found; the daily pages do not load code from the test-run site.
- Testers: 3 to 5, with at least one mouse and one touch screen or stylus, and at least two declared levels.
- Tasks (about 14, from published, verified problems; about 20 minutes):

| Type | Number | Task | Tests |
|---|---|---|---|
| T1 | 6 | arrows on a rendered structure for one elementary step with a known result (substitution, carbonyl addition, elimination, proton transfer with a drawn H, enolate alkylation, iminium formation) | canvas, snapping, C1, I0 |
| T2 | 4 | copy a displayed structure by hand (chain with heteroatom, ring, charged species, stereocentre not required) | R0, correction |
| T3 | 2 | rendered substrate; the tester hand-draws the reagent or a change of the structure, then arrows | mixed ink and rendering |
| T4 | 2 | a mechanism drawn by M0 is displayed; the tester marks each step correct, wrong or unclear | M0 output, arrow rendering |

  A short questionnaire at the end (5 questions: input device comfort, clarity of the conventions, blocking problems).

- Readiness criteria (proposed; with about 60 entries the percentages are indicative, the decision is the user's):

| Criterion | Threshold |
|---|---|
| Stored rows that replay to the same result (`src/mech_replay.js`) | 100 % |
| Reference steps of the tasks reproduced by C1; C1 tests | 100 %; all pass |
| T1: first reading accepted / accepted within 3 readings | ≥ 80 % / ≥ 95 %, reported per pointer type |
| T2: structure confirmed without correction / with at most 2 corrections | ≥ 60 % / ≥ 90 % |
| Tasks started that are completed; median time per T1 entry | ≥ 80 %; ≤ 60 s |
| T4: steps marked correct | reported; no threshold (M0 quality, not tool readiness) |
| Blocking problem reported by at least 2 testers | none |

- Outcome: a report (`REPORT.md` in QDher/Daily_Curly_Chem) with the criteria, the failed entries by cause (recognition, snapping,
  convention, page) and the changes proposed. Below threshold: fix and repeat with the same tasks. All met: phase 3
  by pull request.

### G. Later: mechanisms on 3D structures

Not built. The only requirement now is in section B: arrows by atom id and optional 3D coordinates in the graph.
- Conformer per species from RDKit (ETKDG, then MMFF94) in the scheduled run or the Worker; whether RDKit's JavaScript
  build can do it in the page is to be checked.
- 3D viewer with atom and bond picking (e.g. 3Dmol.js); an arrow is entered by picking source and sink and shown as a
  curve in 3D; C1, C3 and C4 are unchanged.
- Hydrogens are explicit in 3D, so the implicit-hydrogen rule applies to the 2D views only.
- Possible gain: geometric conditions of a step (anti-periplanar elimination, trajectory of attack on C=O, facial
  selectivity) become part of the recorded data.

### Open decisions

| Decision | Proposal |
|---|---|
| Claude API in the test run (R1) | not used: R0 and I0 need no call; M0 runs in a maintenance session before the test run. Decide on R1 from the T2 results |
| Who pays API calls in phase 3, daily limit | open |
| Notice to visitors and publication of the data | page states that drawings (strokes with timing) and answers are stored anonymously; publication and licence (CC0 proposed) decided before phase 3 |
| Ketcher | kept on the daily pages; freehand is an additional input until R2 is measured |

## Compute: HPC cluster (Nibi, Digital Research Alliance of Canada) (note, 2026-11-11)

Not needed now; useful later for training and batch jobs only.

| Task | HPC useful? |
|---|---|
| Feedback statistics, difficulty and rating models, Thompson sampling, Tier A | No: seconds of CPU; queue wait and data transfer exceed the computation |
| RXNMapper or forward prediction on the daily candidates | No: a few reactions per day, CPU inference is enough |
| The same models over a large candidate pool (results stored as flags in the repository) | Yes, as an occasional batch job (GPU) |
| Drawing recognition (R2, section C2): pre-training on synthetic ink, training on collected strokes | Yes, training and evaluation only |
| Intent and mechanism models (I1, M1, sections C3 and C4): pre-training on public datasets, then on crowd data | Yes: the main case (GPU hours to days) |

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

1. Worker: `views`, revision and rule-version columns, keyed per-row export (`checks` added 2026-11-11).
2. `src/feedback_stats.py` and remark labels; step 3b reads them.
3. Pull-request step in the scheduled runs (needs GitHub write access from the scheduled sessions; not verified).
4. Difficulty model (One-Pot) and quality model (Name Reaction Daily) in shadow mode.
5. Selection ranking, after the activation review.

Finding (2026-11-11): `src/tier_a.py` lists 17 resonance forms of published intermediates that the page rejects
(14 One-Pot, 3 Name Reaction Daily), mostly α-amino carbocations drawn for iminium ions. Tier A adds them only when
visitors draw them; accepting the whole class in `src/chemkey.js` would be a Tier B change.
