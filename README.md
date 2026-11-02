# One-Pot Puzzles

Daily organic chemistry mechanism puzzles taken from total synthesis papers. A new set of three problems (undergraduate, graduate, advanced) appears every day at 10:00 America/New_York.

- `index.html`: the page, built from `src/index.src.html`, `src/chemkey.js` and `data/problems.json`
- `data/problems.json`: schedule and all daily sets
- `src/`: curation, validation and build scripts; `src/PIPELINE.md` describes how a set is added
- `rdkit/RDKit_minimal.wasm`: RDKit runtime used by the page

The site is deployed by `.github/workflows/pages.yml` on every push to `main` (Settings → Pages → Source: GitHub Actions).
