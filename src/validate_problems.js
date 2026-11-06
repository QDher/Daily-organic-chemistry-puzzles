// Checks data/problems.json before publishing. Exit code 1 if anything fails.
// Usage (from the project root, after `npm install @rdkit/rdkit@2026.9.1`):
//   node src/validate_problems.js [data/problems.json]
const path = require('path');
const fs = require('fs');
const init = require('@rdkit/rdkit');
const { speciesInfo, matches, substrateFingerprint } = require('./chemkey.js');
const file = process.argv[2] || path.join(__dirname, '..', 'data', 'problems.json');
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const LEVELS = ['undergraduate', 'graduate', 'advanced'];
const MAX_HINTS = { undergraduate: 3, graduate: 5, advanced: 8 };
// From this date on: a step starts only when a reagent is added or the solvent/temperature changes,
// and the advanced problem has at least 2 such steps. Earlier sets were written under the old rule.
const STEP_RULE_FROM = '2026-11-06';
// From this date on: increasing scores within the set, and an advanced problem with a specialized step or an
// uncommon reagent and a score >= 8, a graduate score >= 3, under the step-level score (curate.py). Earlier sets keep their problems.
const DIFF_RULE_FROM = '2026-11-08';
const STEP_LEVELS = ['undergraduate', 'graduate', 'specialized'];
const MIN_SCORE = { graduate: 3, advanced: 8 };
// reagents that are never "uncommon" (taught in undergraduate / graduate courses)
const COMMON = /^(NaBH₄|NaBH4|LiAlH₄|LiAlH4|LDA|LiHMDS|n-BuLi|t-BuOK|KOt-Bu|NaOt-Bu|PPh₃|PPh3|POCl₃|POCl3|NaOH|KOH|LiOH|HCl|HBr|H₂SO₄|H2SO4|H₃O⁺|NaH|Et₃N|Et3N|DIBAL|MeI|CH₃I|BF₃|BF3|p-TsOH|TsOH|K₂CO₃|K2CO3|Cs₂CO₃|NaOMe|NaOEt|TFA|AcOH|Ac₂O|Ac2O|H₂O|H2O|MeOH|EtOH|pyridine|DMAP|DCC|EDCI|mCPBA|m-CPBA|OsO₄|OsO4|Pd\/C|SOCl₂|SOCl2|Br₂|Br2|I₂|I2|NBS|TBAF|Boc₂O|Boc2O|ethylene glycol|N₂H₄|N2H4|NH₃|NH3|HCN|NaCN|KCN|MeMgI|MeMgBr|PCC|DMP|Dess|Swern|O₃|O3|CH₃PPh₃Br|Ph₃P=CH₂)\b/i;
const NO_CHANGE = /^\s*(same pot|see si|n\/a|-|—)?\s*\.?\s*$/i;

// Text shown before solving (substrate label, reagent text, conditions) must not indicate the mechanism,
// fragments lost or reacting atoms. Mechanistic wording belongs in intermediate labels and "reaction".
const LEAK = /intramolecular|intermolecular|cycli[sz]|annulation|fragment|eliminat|rearrang|sigmatropic|\[\d,\d\]|migrat|loss of|\blost\b|extru|decarboxyl|tautomer|aldol|michael|wittig|ylide|acceptor|\bdonor|\bsource\b|carbamic|isocyanate|intermediate|\bvia\b|attack|nucleophil|electrophil|modification|procedure/i;
function leakErrors(P) {
  const out = [], seen = (where, s) => { const m = String(s || '').match(LEAK); if (m) out.push(`${where} "${s}" contains "${m[0]}"`); };
  seen('substrate label', P.substrate && P.substrate.label);
  for (const st of P.steps || []) {
    seen(`step ${st.n} conditions`, st.conditions);
    for (const r of st.reagents || []) {
      seen(`step ${st.n} reagent`, r.text);
      if (r.smiles && /^\[[A-Z][a-z]?H?[0-3]?\+\]$/.test(r.smiles)) out.push(`step ${st.n} reagent "${r.text}" drawn as a bare cation (${r.smiles}); give the real reagent`);
    }
  }
  return out;
}

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
    if (day.date >= DIFF_RULE_FROM && !(scores[0] < scores[1] && scores[1] < scores[2])) err(day.date, `difficulty scores must increase (found ${scores.join(' / ')}); run curate.py --write`);

    for (const P of day.problems) {
      const w = `${day.date} ${P.level} ${P.id}`;
      if (ids.has(P.id)) err(w, `id already used on ${ids.get(P.id)}`); else ids.set(P.id, day.date);
      const stepKey = (P.source && P.source.doi) + ' | ' + P.reaction;
      if (steps.has(stepKey)) err(w, `same paper and reaction already used on ${steps.get(stepKey)}`); else steps.set(stepKey, day.date);
      for (const k of ['reaction', 'source', 'substrate', 'steps', 'product', 'mechanismRefs', 'hints', 'difficulty', 'textbookLevel'])
        if (!(k in P)) err(w, `missing field "${k}"`);
      if (!P.source || !/^10\.\d{4,9}\//.test(P.source.doi || '')) err(w, 'source.doi missing or malformed');
      leakErrors(P).forEach(m => err(w, 'mechanism indicated before solving: ' + m));
      // difficulty classification (curate.py score)
      P.steps.forEach(st => { if (!STEP_LEVELS.includes(st.stepLevel)) err(w, `step ${st.n}: "stepLevel" must be one of ${STEP_LEVELS.join(', ')}`); });
      P.steps.forEach(st => st.reagents.forEach(r => { if (r.uncommon && COMMON.test((r.text || '').trim())) err(w, `reagent "${r.text}" is a common reagent; remove "uncommon"`); }));
      if (P.level === 'graduate') {
        if (!P.steps.some(st => st.stepLevel === 'graduate')) err(w, 'graduate problem needs at least one step with stepLevel "graduate"');
        if (day.date >= DIFF_RULE_FROM && !(P.difficulty && P.difficulty.score >= MIN_SCORE.graduate)) err(w, `graduate problem needs a score of at least ${MIN_SCORE.graduate} (found ${P.difficulty && P.difficulty.score})`);
        if (!(P.courseRef || '').trim()) err(w, 'graduate problem needs "courseRef" (book and chapter, or course notes, where the reaction is taught)');
      }
      if (P.level === 'advanced' && day.date >= DIFF_RULE_FROM) {
        if (!P.steps.some(st => st.stepLevel === 'specialized') && !P.steps.some(st => st.reagents.some(r => r.uncommon)))
          err(w, 'advanced problem needs a step with stepLevel "specialized" or an uncommon reagent');
        if (!(P.difficulty && P.difficulty.score >= MIN_SCORE.advanced)) err(w, `advanced problem needs a score of at least ${MIN_SCORE.advanced} (found ${P.difficulty && P.difficulty.score})`);
      }
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
      // species are compared as on the page: same structure up to protonation, counterions, stereo and
      // tautomers in which protons move to or from N, O or S (chemkey.js)
      const sub = speciesInfo(R, P.substrate.smiles, fp), prod = speciesInfo(R, P.product.smiles, fp);
      if (!sub.key) err(w, 'substrate SMILES unreadable');
      if (!prod.key) err(w, 'product SMILES unreadable');
      if (matches(sub, prod)) err(w, 'product is the same species as the substrate');
      const seen = [{ label: 'substrate', infos: [sub] }, { label: 'product', infos: [prod] }];
      let distinct = 0;
      for (const st of P.steps) for (const [k, it] of st.intermediates.entries()) {
        const infos = it.forms.map(f => speciesInfo(R, f, fp));
        if (!it.forms.length || infos.some(x => !x.key)) err(w, `step ${st.n} intermediate ${k + 1}: unreadable or missing form`);
        const clash = seen.filter(o => o.infos.some(a => infos.some(b => matches(a, b)))).map(o => o.label);
        if (clash.length) err(w, `step ${st.n} intermediate ${k + 1} is the same species as ${clash.join(', ')} (tautomer with a proton moved to or from N/O/S, protonation state or resonance form); merge or remove it`);
        else distinct++;
        seen.push({ label: `step ${st.n} intermediate ${k + 1}`, infos });
      }
      if (distinct < 2) err(w, `only ${distinct} distinct intermediate(s); at least 2 are required`);

      const nh = (P.hints || []).length;
      if (nh < 2 || nh > MAX_HINTS[P.level]) err(w, `${nh} hints (expected 2 to ${MAX_HINTS[P.level]}); run curate.py --write`);
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
