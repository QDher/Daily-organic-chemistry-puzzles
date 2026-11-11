// Tests of the Worker against a local D1 database (Miniflare). Run: npm test
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { toSql, parseList, fromSupabase } from '../tools/import_supabase.js';
import { round2, median } from '../src/stats.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://qdher.github.io';
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: ['index.js', 'rows.js', 'stats.js'].map(f => ({ type: 'ESModule', path: path.join(root, 'src', f) })),
  modulesRoot: path.join(root, 'src'),
  compatibilityDate: '2026-10-23',
  d1Databases: { DB: 'test-db' },
  bindings: { ALLOWED_ORIGINS: ORIGIN },
}));
const db = await mf.getD1Database('DB');
const statements = sql => sql.replace(/^\s*--.*$/gm, '').split(/;\s*$/m).map(s => s.trim()).filter(Boolean);
for (const f of fs.readdirSync(path.join(root, 'migrations')).sort()) {
  for (const s of statements(fs.readFileSync(path.join(root, 'migrations', f), 'utf8'))) await db.prepare(s).run();
}

const call = async (method, p, body, origin = ORIGIN) => {
  const headers = { 'Content-Type': 'application/json' };
  if (origin) headers.Origin = origin;
  const r = await mf.dispatchFetch('http://localhost' + p, { method, headers, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  const text = await r.text();
  return { status: r.status, headers: r.headers, data: text ? JSON.parse(text) : null };
};
const post = (p, b, o) => call('POST', p, b, o);
const rpc = async (fn, args) => {
  const r = await post('/rpc/' + fn, args);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
};
const U = i => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok', name); };

try {
  await t('CORS: allowed origin, other origin refused, no origin accepted', async () => {
    const pre = await call('OPTIONS', '/results');
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('Access-Control-Allow-Origin'), ORIGIN);
    assert.match(pre.headers.get('Access-Control-Allow-Headers'), /Content-Type/);
    assert.equal((await call('OPTIONS', '/results', undefined, 'https://example.org')).status, 403);
    assert.equal((await post('/rpc/problem_summary', { p_site: 'onepot' }, 'https://example.org')).status, 403);
    const r = await post('/rpc/problem_summary', { p_site: 'onepot' }, null);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), null);
  });

  await t('insert, duplicate refused (also with upper-case client id), other site accepted', async () => {
    const row = { site: 'onepot', problem_id: 'p1', client_id: U(1), checks: 2, hints: 0, score: 2, revealed: false };
    const r = await post('/results', row);
    assert.equal(r.status, 201);
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
    assert.deepEqual((await post('/results', { ...row, client_id: U(1).toUpperCase(), score: 5 })).data, { error: 'duplicate' });
    assert.equal((await post('/results', { ...row, score: 5 })).status, 409);
    assert.equal((await post('/results', { ...row, site: 'namerxn', score: 4, hints: 1, checks: 3 })).status, 201);
    const stored = await db.prepare('SELECT * FROM results ORDER BY id').all();
    assert.equal(stored.results.length, 2);
    assert.match(stored.results[0].created_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  });

  await t('invalid requests are refused with 400, 404 or 405', async () => {
    const r = { site: 'onepot', problem_id: 'p9', client_id: U(9), checks: 1, hints: 0, score: 1, revealed: false };
    const d = { site: 'onepot', problem_id: 'p9', client_id: U(9), seen: 'never' };
    const bad = [
      ['/results', { ...r, site: 'other' }, 'invalid site'],
      ['/results', { ...r, problem_id: '' }, 'invalid problem_id'],
      ['/results', { ...r, problem_id: 'x'.repeat(121) }, 'invalid problem_id'],
      ['/results', { ...r, client_id: 'abc' }, 'invalid client_id'],
      ['/results', { ...r, checks: 1000 }, 'invalid checks'],
      ['/results', { ...r, hints: -1 }, 'invalid hints'],
      ['/results', { ...r, score: 1.5 }, 'invalid score'],
      ['/results', { ...r, revealed: 'false' }, 'invalid revealed'],
      ['/ratings', { ...r, stars: 6 }, 'invalid stars'],
      ['/ratings', { ...r, stars: 3, remark: 'é'.repeat(201) }, 'invalid remark'],
      ['/difficulty_answers', { ...d, seen: 'school' }, 'invalid seen'],
      ['/difficulty_answers', { ...d, hardest_step: 21 }, 'invalid hardest_step'],
      ['/difficulty_answers', { ...d, known_reagents: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }, 'invalid known_reagents'],
      ['/difficulty_answers', { ...d, unknown_reagents: ['x'.repeat(601)] }, 'invalid unknown_reagents'],
      ['/results', { ...r, user_level: 'professor' }, 'invalid user_level'],
      ['/ratings', { ...r, stars: 3, user_level: 1 }, 'invalid user_level'],
      ['/results', { ...r, score_rule: 3 }, 'invalid score_rule'],
      ['/results', { ...r, score_rule: '2' }, 'invalid score_rule'],
      ['/difficulty_votes', { ...d, vote: 'easy' }, 'invalid vote'],
      ['/difficulty_votes', { ...d, vote: 'too_hard', user_level: 'phd' }, 'invalid user_level'],
      ['/results', '[1]', 'body must be a JSON object'],
      ['/results', 'not json', 'body must be a JSON object'],
      ['/results', JSON.stringify({ ...r, pad: 'x'.repeat(5000) }), 'body too large'],
      ['/rpc/drop_table', { p_site: 'onepot' }, 'unknown function'],
      ['/rpc/problem_stats', { p_site: 'onepot' }, 'invalid p_problem'],
      ['/rpc/problem_summary', { p_site: 'x' }, 'invalid p_site'],
      ['/rpc/feedback_export', { p_site: 'onepot', p_since: 'yesterday' }, 'invalid p_since'],
    ];
    for (const [p, b, msg] of bad) {
      const res = await post(p, b);
      assert.deepEqual([res.status, res.data], [400, { error: msg }], p + ' ' + msg);
    }
    assert.equal((await call('GET', '/results')).status, 405);
    assert.equal((await post('/other', {})).status, 404);
    assert.equal((await post('/rest/v1/results', r)).status, 404);
    assert.equal((await post('/ratings', { ...r, stars: 3, remark: 'é'.repeat(200) })).status, 201);
  });

  await t('import of Supabase CSV exports (Postgres text formats), repeated import changes nothing', async () => {
    const recent = new Date(Date.now() - 5 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
    const old = new Date(Date.now() - 200 * 86400000).toISOString().slice(0, 19).replace('T', ' ');
    const results = ['id,site,problem_id,client_id,checks,hints,score,revealed,created_at',
      `10,onepot,p2,${U(2)},3,0,3,false,${recent}.123456+00`,
      `11,onepot,p2,${U(3)},8,0,8,f,${recent}.2+00`,
      `12,onepot,p2,${U(4)},2,1,3,true,${recent}.3+00`,
      `13,onepot,p2,${U(5)},4,0,4,FALSE,${recent}.4+00`,
      `14,onepot,p2,${U(6)},4,0,4,maybe,${recent}+00`,
      `15,onepot,p1,${U(1)},9,0,9,false,${recent}+00`].join('\r\n') + '\r\n';
    const ratings = ['id,site,problem_id,client_id,stars,remark,created_at',
      `20,onepot,p2,${U(2)},5,,${recent}.5+00`,
      `21,onepot,p2,${U(3)},3,"it's ""hard"", with a comma\nand a new line",${old}+00`,
      `22,onepot,p2,${U(7)},4,'; DROP TABLE ratings; --,${recent}.6+00`,
      ...Array.from({ length: 40 }, (_, i) => `${100 + i},onepot,p3,${U(100 + i)},${i < 27 ? 3 : i < 37 ? 2 : 1},,${recent}+00`)].join('\n');
    const difficulty = ['id,site,problem_id,client_id,seen,hardest_step,known_reagents,unknown_reagents,created_at',
      `1,onepot,p2,${U(2)},graduate,2,"{LiAlH4,""9-BBN, then H2O2""}",{},${recent}+00`,
      `2,onepot,p2,${U(3)},never,,[],"[""9-BBN, then H2O2""]",${recent}+00`,
      `3,onepot,p2,${U(4)},graduate,2,,,${recent}+00`].join('\n');
    const { sql, counts, errors } = toSql([results, ratings, difficulty]);
    assert.deepEqual(counts, { results: { rows: 5, skipped: 1 }, ratings: { rows: 43, skipped: 0 }, difficulty_answers: { rows: 3, skipped: 0 } });
    assert.deepEqual(errors, [{ table: 'results', line: 6, reason: 'invalid revealed' }]);
    for (let k = 0; k < 2; k++) for (const s of statements(sql)) await db.prepare(s).run();
    assert.equal((await db.prepare('SELECT count(*) n FROM ratings').first()).n, 44);
    // the existing row of visitor 1 on p1 is kept
    assert.equal((await db.prepare("SELECT score FROM results WHERE site = 'onepot' AND problem_id = 'p1'").first()).score, 2);
    assert.deepEqual(parseList('{a,"b \\"c\\"",NULL,"NULL"}'), ['a', 'b "c"', 'NULL']);
  });

  await t('problem_stats', async () => {
    assert.deepEqual(await rpc('problem_stats', { p_site: 'onepot', p_problem: 'p2' }),
      { solved: { 3: 1, 4: 1, 8: 1 }, revealed: 1, ratings: { n: 3, mean: 4, dist: { 3: 1, 4: 1, 5: 1 } } });
    assert.deepEqual(await rpc('problem_stats', { p_site: 'onepot', p_problem: 'none' }),
      { solved: {}, revealed: 0, ratings: { n: 0, mean: null, dist: {} } });
  });

  await t('problem_summary: median of solvers only, means rounded like Postgres; GET form', async () => {
    const s = await rpc('problem_summary', { p_site: 'onepot' });
    assert.deepEqual(s.map(r => r.problem_id), ['p1', 'p2', 'p3', 'p9']);
    assert.deepEqual(s.find(r => r.problem_id === 'p2'), { problem_id: 'p2', n_results: 4, n_revealed: 1, median_score: 4, n_ratings: 3, mean_stars: 4 });
    assert.equal(s.find(r => r.problem_id === 'p3').mean_stars, 2.6); // (27*3 + 10*2 + 3) / 40
    assert.equal(round2(107, 40), 2.68); // 2.675
    assert.equal(round2(2, 3), 0.67);
    assert.equal(median([2, 3]), 2.5);
    const g = await call('GET', '/rpc/problem_summary?p_site=namerxn', undefined, null);
    assert.deepEqual(g.data, [{ problem_id: 'p1', n_results: 1, n_revealed: 0, median_score: 4, n_ratings: 0, mean_stars: null }]);
  });

  await t('feedback_export: last 120 days by default, joined with the rater\'s result, in time order', async () => {
    const fe = await rpc('feedback_export', { p_site: 'onepot' });
    const p2 = fe.filter(r => r.problem_id === 'p2');
    assert.deepEqual(p2.map(r => [r.stars, r.remark, r.score, r.revealed]), [[5, null, 3, false], [4, "'; DROP TABLE ratings; --", null, null]]);
    assert.deepEqual(Object.keys(p2[0]), ['problem_id', 'stars', 'remark', 'created_at', 'score', 'revealed']);
    assert.match(p2[0].created_at, /T\d\d:\d\d:\d\d\.500Z$/); // ".5+00"
    const imported = await db.prepare("SELECT created_at FROM results WHERE problem_id = 'p2' AND client_id = ?").bind(U(2)).first();
    assert.match(imported.created_at, /\.123Z$/); // ".123456+00"
    const allRows = await rpc('feedback_export', { p_site: 'onepot', p_since: '2000-01-01' });
    assert.equal(allRows.find(r => r.stars === 3 && r.problem_id === 'p2').remark, 'it\'s "hard", with a comma\nand a new line');
    for (let i = 1; i < allRows.length; i++) assert.ok(allRows[i - 1].created_at <= allRows[i].created_at);
  });

  await t('difficulty_summary', async () => {
    assert.deepEqual(await rpc('difficulty_summary', { p_site: 'onepot' }), [{
      problem_id: 'p2', answers: 3, seen_undergraduate: 0, seen_graduate: 2, seen_papers: 0, seen_never: 1,
      hardest_step: { 2: 2 }, reagents: { LiAlH4: { known: 1, unknown: 0 }, '9-BBN, then H2O2': { known: 1, unknown: 1 } },
      votes: { n: 0, too_easy: 0, about_right: 0, too_hard: 0 } }]);
    assert.equal((await post('/difficulty_answers', { site: 'onepot', problem_id: 'p4', client_id: U(8), seen: 'papers',
      hardest_step: null, known_reagents: ['TMSCl'], unknown_reagents: [] })).status, 201);
    const d = (await rpc('difficulty_summary', { p_site: 'onepot' })).find(r => r.problem_id === 'p4');
    assert.deepEqual([d.answers, d.seen_papers, d.hardest_step, d.reagents], [1, 1, {}, { TMSCl: { known: 1, unknown: 0 } }]);
  });

  await t('user level and scoring rule stored, not returned; old rows default to rule 1 and no level', async () => {
    const r = { site: 'onepot', problem_id: 'p5', client_id: U(30), checks: 1, hints: 0, score: 1, revealed: false };
    assert.equal((await post('/results', { ...r, user_level: 'graduate', score_rule: 2 })).status, 201);
    assert.equal((await post('/results', { ...r, client_id: U(31) })).status, 201);
    assert.equal((await post('/ratings', { site: 'onepot', problem_id: 'p5', client_id: U(30), stars: 4, user_level: 'graduate' })).status, 201);
    assert.equal((await post('/difficulty_answers', { site: 'onepot', problem_id: 'p5', client_id: U(30), seen: 'graduate', user_level: 'postgraduate' })).status, 201);
    const rows = (await db.prepare("SELECT client_id, user_level, score_rule FROM results WHERE problem_id = 'p5' ORDER BY id").all()).results;
    assert.deepEqual(rows.map(x => [x.user_level, x.score_rule]), [['graduate', 2], [null, 1]]);
    assert.equal((await db.prepare("SELECT user_level FROM ratings WHERE problem_id = 'p5'").first()).user_level, 'graduate');
    assert.equal((await db.prepare("SELECT user_level FROM difficulty_answers WHERE problem_id = 'p5'").first()).user_level, 'postgraduate');
    const out = JSON.stringify([await rpc('problem_stats', { p_site: 'onepot', p_problem: 'p5' }), await rpc('problem_summary', { p_site: 'onepot' }),
      await rpc('feedback_export', { p_site: 'onepot' }), await rpc('difficulty_summary', { p_site: 'onepot' })]);
    assert.ok(!/user_level|postgraduate|score_rule/.test(out));
  });

  await t('difficulty votes: one per visitor and problem, counted in difficulty_summary', async () => {
    const v = { site: 'onepot', problem_id: 'p6', client_id: U(40), vote: 'too_hard', user_level: 'undergraduate' };
    assert.equal((await post('/difficulty_votes', v)).status, 201);
    assert.equal((await post('/difficulty_votes', { ...v, vote: 'too_easy' })).status, 409);
    assert.equal((await post('/difficulty_votes', { ...v, client_id: U(41), vote: 'about_right', user_level: undefined })).status, 201);
    assert.equal((await post('/difficulty_votes', { ...v, client_id: U(42) })).status, 201);
    assert.equal((await call('GET', '/difficulty_votes')).status, 405);
    const d = (await rpc('difficulty_summary', { p_site: 'onepot' })).find(r => r.problem_id === 'p6');
    assert.deepEqual(d, { problem_id: 'p6', answers: 0, seen_undergraduate: 0, seen_graduate: 0, seen_papers: 0, seen_never: 0,
      hardest_step: {}, reagents: {}, votes: { n: 3, too_easy: 0, about_right: 1, too_hard: 2 } });
    assert.deepEqual((await rpc('difficulty_summary', { p_site: 'onepot' })).find(r => r.problem_id === 'p2').votes,
      { n: 0, too_easy: 0, about_right: 0, too_hard: 0 });
  });

  await t('checks: one row per visitor and structure, validated, limited; check_clusters', async () => {
    const c = (i, key, smiles, extra = {}) => ({ site: 'onepot', problem_id: 'p7', client_id: U(i), key, smiles, verdict: 'none', hints: 0, seconds: 30, ...extra });
    const K1 = 'InChI=1S/C3H5/c1-3-2/h3H,1-2H2/q+1', K2 = 'InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3';
    for (const i of [50, 51, 52]) assert.equal((await post('/checks', c(i, K1, i === 50 ? 'C=C[CH2+]' : '[CH2+]C=C'))).status, 201);
    assert.equal((await post('/checks', c(50, K1, 'C=C[CH2+]'))).status, 409);
    for (const i of [50, 51]) assert.equal((await post('/checks', c(i, K2, 'CCO'))).status, 201);
    assert.equal((await post('/checks', c(53, K2, 'CCO', { verdict: 'intermediate', step: 1, intermediate: 2, user_level: 'graduate' }))).status, 201);
    const bad = [[c(60, 'CCO', 'CCO'), 'invalid key'], [c(60, K2, ''), 'invalid smiles'], [c(60, K2, 'CCO', { verdict: 'wrong' }), 'invalid verdict'],
      [c(60, K2, 'CCO', { verdict: 'intermediate' }), 'invalid step'], [c(60, K2, 'CCO', { step: 1, intermediate: 1 }), 'invalid step'],
      [c(60, K2, 'CCO', { hints: -1 }), 'invalid hints'], [c(60, K2, 'CCO', { seconds: 1.5 }), 'invalid seconds']];
    for (const [b, msg] of bad) assert.deepEqual((await post('/checks', b)).data, { error: msg }, msg);
    assert.deepEqual(await rpc('check_clusters', { p_site: 'onepot' }), [{ problem_id: 'p7', smiles: 'C=C[CH2+]', visitors: 3 }]);
    assert.deepEqual((await rpc('check_clusters', { p_site: 'onepot', p_min: 2 })).map(r => [r.smiles, r.visitors]), [['C=C[CH2+]', 3], ['CCO', 2]]);
    assert.equal((await post('/rpc/check_clusters', { p_site: 'onepot', p_min: 1 })).status, 400);
    for (let k = 0; k < 200; k++) await db.prepare("INSERT INTO checks (site, problem_id, client_id, key, smiles, verdict, hints) VALUES ('onepot', 'p8', ?, ?, 'C', 'none', 0)").bind(U(70), 'InChI=1S/x' + k).run();
    assert.deepEqual((await post('/checks', { ...c(70, 'InChI=1S/y', 'C'), problem_id: 'p8' })).data, { error: 'too many checks' });
  });

  await t('import from the Supabase REST API (typed values, paging), secret key sent, nothing else', async () => {
    const recent = new Date(Date.now() - 3 * 86400000).toISOString().replace('Z', '+00:00');
    const data = {
      results: Array.from({ length: 1001 }, (_, i) => ({ id: i + 1, site: 'namerxn', problem_id: 'q' + (i % 3), client_id: U(5000 + i),
        checks: 1, hints: 0, score: 1 + (i % 3), revealed: i === 0, created_at: recent })),
      ratings: [{ id: 1, site: 'namerxn', problem_id: 'q1', client_id: U(5001), stars: 2, remark: null, created_at: recent }],
      difficulty_answers: [{ id: 1, site: 'namerxn', problem_id: 'q1', client_id: U(5001), seen: 'papers', hardest_step: null,
        known_reagents: [], unknown_reagents: ['DMP'], created_at: recent }],
    };
    const realFetch = globalThis.fetch, calls = [];
    globalThis.fetch = async (url, opts) => {
      calls.push([url, opts.headers]);
      const u = new URL(url), table = u.pathname.split('/').pop(), off = +u.searchParams.get('offset'), lim = +u.searchParams.get('limit');
      return new Response(JSON.stringify(data[table].slice(off, off + lim)), { status: 200 });
    };
    let res;
    try { res = await fromSupabase('https://example.supabase.co/', 'sb_secret_test'); } finally { globalThis.fetch = realFetch; }
    assert.deepEqual(res.counts, { results: { rows: 1001, skipped: 0 }, ratings: { rows: 1, skipped: 0 }, difficulty_answers: { rows: 1, skipped: 0 } });
    assert.equal(calls.length, 4); // results in two pages
    assert.ok(calls.every(([u, h]) => u.startsWith('https://example.supabase.co/rest/v1/') && h.apikey === 'sb_secret_test' && !h.Authorization));
    for (const st of statements(res.sql)) await db.prepare(st).run();
    const s = await rpc('problem_summary', { p_site: 'namerxn' });
    assert.deepEqual(s.find(r => r.problem_id === 'q1'), { problem_id: 'q1', n_results: 334, n_revealed: 0, median_score: 2, n_ratings: 1, mean_stars: 2 });
    assert.equal(s.find(r => r.problem_id === 'q0').n_revealed, 1);
    const fe = await rpc('feedback_export', { p_site: 'namerxn' });
    assert.deepEqual(fe.map(r => [r.problem_id, r.stars, r.remark, r.score, r.revealed]), [['q1', 2, null, 2, false]]);
    const d = await rpc('difficulty_summary', { p_site: 'namerxn' });
    assert.deepEqual(d[0].reagents, { DMP: { known: 0, unknown: 1 } });
  });

  console.log(`ALL OK (${n} tests)`);
} finally {
  await mf.dispose();
}
