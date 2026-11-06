# One-Pot Puzzles: how a daily set is added

The published artifact is the source of truth. It contains the page and everything needed to extend it:

| Path | Content |
|---|---|
| `index.html` | the page (built; problems and key function embedded) |
| `data/problems.json` | schedule and all daily sets |
| `src/index.src.html` | page template |
| `src/chemkey.js` | structure comparison (stereo, E/Z, protonation, counterions ignored; tautomers only when protons move to or from N, O or S) |
| `src/curate.py` | atom hints and difficulty score from the mechanism |
| `src/validate_problems.js` | checks before publishing |
| `src/build.js` | builds `index.html` |
| `src/test_chemkey.js` | unit tests of the key |
| `rdkit/RDKit_minimal.wasm` | RDKit runtime (already published; never needs re-uploading) |
| `ketcher/` | Ketcher structure editor (standalone build, loaded by the page in an iframe; already published; never needs re-uploading) |

## 1. Set up

```bash
mkdir -p work && cd work            # put the artifact files here: index.html, data/, src/
npm init -y >/dev/null && npm install @rdkit/rdkit@2026.9.1
pip download --no-deps rdkit==2026.9.1 -d whl        # a plain `pip install rdkit` can stall
pip install --break-system-packages --no-deps whl/rdkit-*.whl
node src/test_chemkey.js            # every case must pass (last line: N/N as expected)
```

## 2. Which date

A new set appears every day at 10:00 America/New_York (`schedule` in `data/problems.json`). Add one set for the earliest date, from tomorrow on, that has no set. If tomorrow and the day after already have sets, add nothing.

## 3. Choosing the three problems

Each set has exactly three problems, in this order: `undergraduate`, `graduate`, `advanced`.

Common rules:
- Taken from a total synthesis paper; one step of the route carried out in one pot (exception for `advanced` below).
- Case 1: one step with several bonds made/broken; or case 2: several steps in one pot (each step listed separately).
- What counts as a step: a step starts only when a reagent is added or the solvent or temperature is changed. Successive mechanistic events under unchanged conditions (no added reagent, same solvent and temperature) are intermediates of the same step; never split them into separate steps.
- The mechanism is described in the paper/SI, or is the established mechanism of a named reaction (give a reference).
- At least 2 distinct intermediates after the key is applied (intermediates that differ only by a proton, a counterion or a tautomer in which protons move to or from N, O or S count as one; a proton moved from one carbon to another gives a different species; carbocations and oxocarbenium ions stay distinct).
- The product can be deduced from substrate + reagents without the paper.
- Never reuse an `id`, nor the same paper + reaction. Prefer three different papers in one set, and avoid repeating a reaction type used in the previous 7 days.
- The number of hints a mechanism allows must not influence the choice of problem.

Per level:
- `undergraduate`: a reaction/mechanism covered in undergraduate textbooks (Clayden, Klein, Wade, McMurry, Bruice). Any publication year. `textbookLevel: "undergraduate"`.
- `graduate`: a named reaction covered at graduate level (Kürti–Czakó, Carey–Sundberg B, Clayden advanced chapters). Any publication year. `textbookLevel: "graduate"`.
- `advanced`: a total synthesis in a top-tier journal: J. Am. Chem. Soc., Nature, Science, Nature Chemistry, Nature Synthesis, Angew. Chem. Int. Ed., Chem.
  - Publication window: first papers published online within the 31 days before the run date; if none qualifies, widen the window progressively up to 6 months (183 days). Check the online publication date (Crossref `published-online`).
  - Shape: at least 2 steps in the sense above (each starting with an added reagent or a change of solvent/temperature), each with at least one intermediate that is distinct after the key; difficulty score > 10.
  - A one-pot sequence is preferred. If no qualifying one-pot process is found in the window, two sequential reactions shown in the same scheme of the paper (consecutive steps of the route, both fully described) may be used instead; each reaction is then at least one step. Say in `source.context` and `verificationNote` that these are separate operations, and give conditions for each.
  - `textbookLevel: "specialized"`, or `"graduate"` if the steps are textbook named reactions.
  - If no paper from the 6-month window can be read in enough detail to write correct structures with this shape, do not add a set; report this instead.

Where to look: PubMed (`search_articles` with journal and date filters; `get_full_text_article` for PMC full text, which includes many recent open-access JACS, Angewandte and Nature-family papers), then web search and publisher pages. Read the scheme and the SI for structures and conditions whenever accessible.

Difficulty (`curate.py`): every step has `stepLevel` ("undergraduate" | "graduate" | "specialized", judged on the chemistry of the step, not on how much detail the paper gives) and reagents not taught in undergraduate or graduate courses have `"uncommon": true`. Step score: undergraduate 1; graduate 2 + 0.5 × σ bonds of the step; specialized 3 + intermediates of the step + 0.5 × σ bonds of the step; + 1 per distinct uncommon reagent (max 2). The graduate problem has a graduate step and a `courseRef`; the advanced problem has a specialized step or an uncommon reagent and a score > 10. The score must increase within the set: undergraduate < graduate < advanced. If it does not, choose another problem rather than editing the score.

## 4. Writing an entry

Copy the shape of an existing entry in `data/problems.json`:

```json
{
  "id": "<journal><year>-<short-reaction-name>",          // unique, kebab-case
  "level": "undergraduate | graduate | advanced",
  "textbookLevel": "undergraduate | graduate | specialized",
  "reaction": "name of the transformation (shown only after solving)",
  "source": { "citation": "Authors. Title. Journal Year, Vol, pages.", "doi": "10.xxxx/...", "context": "which step of the route" },
  "verified": false,
  "verificationNote": "what was reconstructed and what a chemist should check",
  "substrate": { "label": "short label", "smiles": "..." },
  "steps": [
    { "n": 1, "reagents": [ { "text": "TsNHNH₂", "smiles": "..." }, { "text": "NaOt-Bu" } ],
      "conditions": "solvent, temperature (or \"see SI\")",
      "intermediates": [ { "label": "Name (bond made/broken)", "forms": ["SMILES", "alternative drawing", "..."] } ] }
  ],
  "product": { "label": "short label", "smiles": "..." },
  "byproducts": "text",
  "mechanismRefs": ["reference 1", "reference 2"]
}
```

Structure rules:
- No stereochemistry is needed (it is ignored); E/Z is ignored too.
- Intermediates in mechanism order, one entry per intermediate. Draw the species derived from the substrate (with reagent fragments attached when bonded). Charged species as charged atoms (`[O-]`, `[C+]`, `[O+]=`), radicals as `[C]`, `[N]`, etc.
- `forms`: every drawing a student could reasonably give for the same species: resonance forms of carbanions/carbocations (e.g. ylide `C=P` and `[C-][P+]`), alternative esters when the paper uses a mixture.
- Reagents get a SMILES when their atoms enter the product or an intermediate (used for hints); catalysts and simple acids/bases can be text only.
- A step with no added reagent (`"reagents": []`, shown as "—") exists only when the solvent or temperature changes; its `conditions` state that change (e.g. "PhMe, 110 °C" after a step at rt, or "solvent exchanged to MeOH") and nothing else. Conditions such as "same pot", or identical to the previous step, are not a new step: merge the intermediates into the previous step. A work-up that adds a reagent (e.g. aqueous acid) is a step with that reagent listed. Nothing seen before solving may indicate the mechanism (no "intramolecular", "[3,3]", "cyclisation", "fragmentation", etc. in reagents or conditions).
- `hints` and `difficulty` are written by `curate.py`; do not write them by hand.
- Always `"verified": false` for new entries; a chemist sets it to true after checking against the paper.

## 5. Check, build, publish

Before building, compare the substrate, the product and every reagent that has a SMILES with PubChem (PUG-REST, by name and by structure; first 14 characters of the InChIKey). A mismatch means the SMILES is wrong; a species with no PubChem entry is not an error. Record the matches (CIDs) in `verificationNote`.

```bash
python3 src/curate.py data/problems.json --write     # hints + difficulty; read the printed bond changes
node src/validate_problems.js data/problems.json     # must end with ALL OK (from 2026-11-06 it also rejects steps without a change of reagent/conditions and advanced problems with fewer than 2 steps)
node src/build.js                                    # writes index.html
```

Read the bond changes that `curate.py` prints for the new problems. Each transition should list the bonds the mechanism makes and breaks. If a transition lists unexpected bonds, an intermediate SMILES is probably wrong; fix it and run the tool again.

Publish to the same artifact URL with the Artifact tool: `file_path` = `index.html`, `url` = the artifact URL, and `files`:

```json
{
  "data/problems.json": "data/problems.json",
  "src/index.src.html": { "from": "src/index.src.html", "contentType": "text/plain" },
  "src/chemkey.js": "src/chemkey.js",
  "src/curate.py": { "from": "src/curate.py", "contentType": "text/plain" },
  "src/validate_problems.js": "src/validate_problems.js",
  "src/build.js": "src/build.js",
  "src/test_chemkey.js": "src/test_chemkey.js",
  "src/PIPELINE.md": { "from": "src/PIPELINE.md", "contentType": "text/markdown" }
}
```

(`rdkit/RDKit_minimal.wasm` is kept automatically when left out.)

## 6. Report

Send a short summary: date of the new set; for each level, the reaction, the paper (with DOI link), the number of steps, intermediates and hints, the difficulty score; and the structures that need checking against the paper.
