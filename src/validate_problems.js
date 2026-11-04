// Checks data/problems.json before publishing. Exit code 1 if anything fails.
// Usage (from the project root, after `npm install @rdkit/rdkit@2026.9.1`):
//   node src/validate_problems.js [data/problems.json]
const path = require('path');
const fs = require('fs');
const init = require('@rdkit/rdkit');
const { chemKey, substrateFingerprint } = require('./chemkey.js');
const file = process.argv[2] || path.join(__dirname, '..', 'data', 'problems.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const LEVELS = ['undergraduate', 'graduate', 'advanced'];
const MAX_HINTS = { undergraduate: 3, graduate: 5, advanced: 8 };
// From this date on: a step starts only when a reagent is added or the solvent/temperature changes,
// and the advanced problem has at least 2 such steps. Earlier sets were written under the old rule.
const STEP_RULE_FROM = '2026-11-06';
const NO_CHANGE = /^\s*(same pot|see si|n\/a|-|—)?\s*\.?\s*$/i;

init().then(R => {
  const errors = [];
  const err = (where, msg) => errors.push(`${where}: ${msg}`);

  // schedule and sets
  const dates = data.sets.map(s => s.date);
  if ([...dates].sort().join() !== dates.join()) err('sets', 'dates are not in ascending order');
  if (new Set(dates).size !== dates.length) err('sets', 'duplicate date');
  const ids = new Map(), steps = new Map();

  for (const day of data.sets) {
    const lv = day.problems.map(p => p.level);
    if (lv.join() !== LEVELS.join()) err(day.date, `levels must be ${LEVELS.join(', ')} in that order (found ${lv.join(', ')})`);
    const scores = day.problems.map(p => p.difficulty && p.difficulty.score);
    if (!(scores[0] < scores[1] && scores[1] < scores[2])) err(day.date, `difficulty scores must increase (found ${scores.join(' / ')}); run curate.py --write`);

    for (const P of day.problems) {
      const w = `${day.date} ${P.level} ${P.id}`;
      if (ids.has(P.id)) err(w, `id already used on ${ids.get(P.id)}`); else ids.set(P.id, day.date);
      const stepKey = (P.source && P.source.doi) + ' | ' + P.reaction;
      if (steps.has(stepKey)) err(w, `same paper and reaction already used on ${steps.get(stepKey)}`); else steps.set(stepKey, day.date);
      for (const k of ['reaction', 'source', 'substrate', 'steps', 'product', 'mechanismRefs', 'hints', 'difficulty', 'textbookLevel'])
        if (!(k in P)) err(w, `missing field "${k}"`);
      if (!P.source || !/^10\.\d{4,9}\//.test(P.source.doi || '')) err(w, 'source.doi missing or malformed');
      if (day.date >= STEP_RULE_FROM) {
        P.steps.forEach((st, i) => {
          if (i === 0 || st.reagents.length) return;
          const c = (st.conditions || '').trim(), prev = (P.steps[i - 1].conditions || '').trim();
          if (NO_CHANGE.test(c) || c === prev) err(w, `step ${st.n} adds no reagent and does not change solvent or temperature; merge its intermediates into step ${P.steps[i - 1].n}`);
        });
        if (P.level === 'advanced' && P.steps.length < 2) err(w, 'advanced problem needs at least 2 steps (each starting with an added reagent or a change of solvent/temperature)');
      }

      let fp;
      try { fp = substrateFingerprint(R, P.substrate.smiles); } catch (e) { err(w, 'substrate SMILES unreadable'); continue; }
      const sk = chemKey(R, P.substrate.smiles, fp), pk = chemKey(R, P.product.smiles, fp);
      if (!sk) err(w, 'substrate SMILES unreadable');
      if (!pk) err(w, 'product SMILES unreadable');
      if (sk && sk === pk) err(w, 'product has the same key as the substrate');
      const seen = new Map([[sk, 'substrate'], [pk, 'product']]);
      let distinct = 0;
      for (const st of P.steps) for (const [k, it] of st.intermediates.entries()) {
        const keys = it.forms.map(f => chemKey(R, f, fp));
        if (!it.forms.length || keys.some(x => !x)) err(w, `step ${st.n} intermediate ${k + 1}: unreadable or missing form`);
        const uniq = [...new Set(keys.filter(Boolean))];
        const clash = uniq.filter(x => seen.has(x)).map(x => seen.get(x));
        if (clash.length) err(w, `step ${st.n} intermediate ${k + 1} has the same key as ${clash.join(', ')} (tautomer / protonation state / resonance form); merge or remove it`);
        else distinct++;
        uniq.forEach(x => seen.has(x) || seen.set(x, `step ${st.n} intermediate ${k + 1}`));
      }
      if (distinct < 2) err(w, `only ${distinct} distinct intermediate(s); at least 2 are required`);

      const nh = (P.hints || []).length;
      if (nh < Math.min(3, MAX_HINTS[P.level]) || nh > MAX_HINTS[P.level]) err(w, `${nh} hints (expected up to ${MAX_HINTS[P.level]}); run curate.py --write`);
      for (const h of P.hints || []) {
        let smi = P.substrate.smiles;
        if (h.mol === 'reagent') {
          const st = P.steps.find(s => s.n === h.step);
          const r = st && st.reagents.find(r => r.text === h.reagent);
          smi = r && r.smiles;
        }
        const m = smi && R.get_mol(smi);
        if (!m || !(h.atom >= 0 && h.atom < m.get_num_atoms())) err(w, 'hint atom does not exist: ' + JSON.stringify(h));
        if (m) m.delete();
      }
      console.log(`${w}: ${distinct} intermediates, ${nh} hints, score ${P.difficulty && P.difficulty.score}`);
    }
  }
  if (errors.length) { console.log('\nFAILED\n- ' + errors.join('\n- ')); process.exit(1); }
  console.log('\nALL OK');
});
