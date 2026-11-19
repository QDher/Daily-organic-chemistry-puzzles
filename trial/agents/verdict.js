// Referee of the agent trial: the page's own comparison (src/chemkey.js), so an agent's structure gets exactly the
// verdict a visitor would get. Input on stdin: {"substrate", "product", "intermediates": [{"step", "k", "forms"}],
// "smiles": [...]}. Output: [{"smiles", "key", "verdict": "product"|"intermediate"|"substrate"|"none"|"unreadable",
// "step", "k"}]. Needs @rdkit/rdkit in the repository's node_modules.
const path = require('path');
const ck = require(path.join(__dirname, '..', '..', 'src', 'chemkey.js'));
let input = '';
process.stdin.on('data', d => { input += d; });
process.stdin.on('end', async () => {
  const q = JSON.parse(input);
  const R = await require('@rdkit/rdkit')();
  const fp = ck.substrateFingerprint(R, q.substrate);
  const info = s => ck.speciesInfo(R, s, fp);
  const prod = info(q.product), sub = info(q.substrate);
  const inter = q.intermediates.map(it => ({ ...it, infos: it.forms.map(info) }));
  const out = q.smiles.map(s => {
    const d = info(s);
    if (!d.key) return { smiles: s, key: null, verdict: 'unreadable' };
    if (ck.matches(d, prod)) return { smiles: s, key: d.key, verdict: 'product' };
    const hit = inter.find(it => it.infos.some(x => ck.matches(d, x)));
    if (hit) return { smiles: s, key: d.key, verdict: 'intermediate', step: hit.step, k: hit.k };
    if (ck.matches(d, sub)) return { smiles: s, key: d.key, verdict: 'substrate' };
    return { smiles: s, key: d.key, verdict: 'none' };
  });
  process.stdout.write(JSON.stringify(out));
});
