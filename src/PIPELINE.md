# One-Pot Puzzles: how a daily set is added

The published artifact is the source of truth. It contains the page and everything needed to extend it:

| Path | Content |
|---|---|
| `index.html` | the page (built; problems and key function embedded) |
| `data/problems.json` | schedule and all daily sets |
| `src/index.src.html` | page template |
| `src/chemkey.js` | comparison key (stereo, E/Z, tautomers, protonation, counterions ignored) |
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
node src/test_chemkey.js            # expect 22/22
```

## 2. Which date

A new set appears every day at 10:00 America/New_York (`schedule` in `data/problems.json`). Add one set for the earliest date, from tomorrow on, that has no set. If tomorrow and the day after already have sets, add nothing.

## 3. Choosing the three problems

Each set has exactly three problems, in this order: `undergraduate`, `graduate`, `advanced`.

Common rules:
- Taken from a total synthesis paper; one step of the route carried out in one pot.
- Case 1: one step with several bonds made/broken; or case 2: several steps in one pot (each step listed separately).
- The mechanism is described in the paper/SI, or is the established mechanism of a named reaction (give a reference).
- At least 2 distinct intermediates after the key is applied (intermediates that differ only by a proton, a tautomer or a counterion count as one; carbocations and oxocarbenium ions stay distinct).
- The product can be deduced from substrate + reagents without the paper.
- Never reuse an `id`, nor the same paper + reaction. Prefer three different papers in one set, and avoid repeating a reaction type used in the previous 7 days.
- The number of hints a mechanism allows must not influence the choice of problem.

Per level:
- `undergraduate`: a reaction/mechanism covered in undergraduate textbooks (Clayden, Klein, Wade, McMurry, Bruice). Any publication year. `textbookLevel: "undergraduate"`.
- `graduate`: a named reaction covered at graduate level (Kürti–Czakó, Carey–Sundberg B, Clayden advanced chapters). Any publication year. `textbookLevel: "graduate"`.
- `advanced`: a total synthesis published (online) within the 31 days before the run date in a top-tier journal: J. Am. Chem. Soc., Nature, Science, Nature Chemistry, Nature Synthesis, Angew. Chem. Int. Ed., Chem. Usually several steps or a specialized method (`textbookLevel: "specialized"`, or `"graduate"` if the reaction is a textbook named reaction). If no qualifying paper from that window can be read in enough detail, do not add a set; report this instead.

Where to look: PubMed (`search_articles` with journal and date filters; `get_full_text_article` for PMC full text, which includes many recent open-access JACS, Angewandte and Nature-family papers), then web search and publisher pages. Read the scheme and the SI for structures and conditions whenever accessible.

The difficulty score (from `curate.py`) must increase within the set: undergraduate < graduate < advanced. If it does not, choose another problem rather than editing the score.

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
- A step with no added reagent has `"reagents": []` (the page shows "—") and gives no indication of the mechanism anywhere the student sees before solving (no "intramolecular", "[3,3]", "cyclisation", "fragmentation", etc. in reagents or conditions). Its `conditions` give only solvent and/or temperature when available (otherwise "same pot"); a work-up may be mentioned.
- `hints` and `difficulty` are written by `curate.py`; do not write them by hand.
- Always `"verified": false` for new entries; a chemist sets it to true after checking against the paper.

## 5. Check, build, publish

```bash
python3 src/curate.py data/problems.json --write     # hints + difficulty; read the printed bond changes
node src/validate_problems.js data/problems.json     # must end with ALL OK
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
