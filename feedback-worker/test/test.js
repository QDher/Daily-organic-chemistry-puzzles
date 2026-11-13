// Tests of the Worker against a local D1 database (Miniflare). Run: npm test
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { round2, median } from '../src/stats.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://qdher.github.io';
const mf = new Miniflare(convertV4MiniflareOptions({
  modules: ['index.js', 'rows.js', 'stats.js'].map(f => ({ type: 'ESModule', path: path.join(root, 'src', f) })),
  modulesRoot: path.join(root, 'src'),
  compatibilityDate: '2026-10-23',
  d1Databases: { DB: 'test-db' },
  bindings: { ALLOWED_ORIGINS: ORIGIN, MECH_TESTERS: 'aaaaaaaa,bbbbbbbb', MECH_EXPORT_KEY: 'test-key' },
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

  await t('rows with past dates, written directly to the database', async () => {
    const day = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    const recent = ms => `${day(5)}T12:00:00.${ms}Z`, old = `${day(200)}T12:00:00.000Z`;
    const run = (sql, ...args) => db.prepare(sql).bind(...args).run();
    for (const [i, checks, hints, score, revealed] of [[2, 3, 0, 3, 0], [3, 8, 0, 8, 0], [4, 2, 1, 3, 1], [5, 4, 0, 4, 0]]) {
      await run(`INSERT INTO results (site, problem_id, client_id, checks, hints, score, revealed, created_at)
        VALUES ('onepot', 'p2', ?, ?, ?, ?, ?, ?)`, U(i), checks, hints, score, revealed, recent('100'));
    }
    const rating = (pid, i, stars, remark, at) => run(`INSERT INTO ratings (site, problem_id, client_id, stars, remark, created_at)
      VALUES ('onepot', ?, ?, ?, ?, ?)`, pid, U(i), stars, remark, at);
    await rating('p2', 2, 5, null, recent('500'));
    await rating('p2', 3, 3, 'it\'s "hard", with a comma\nand a new line', old);
    await rating('p2', 7, 4, "'; DROP TABLE ratings; --", recent('600'));
    for (let i = 0; i < 40; i++) await rating('p3', 100 + i, i < 27 ? 3 : i < 37 ? 2 : 1, null, recent('700'));
    for (const [i, seen, hs, known, unknown] of [[2, 'graduate', 2, ['LiAlH4', '9-BBN, then H2O2'], []],
      [3, 'never', null, [], ['9-BBN, then H2O2']], [4, 'graduate', 2, [], []]]) {
      await run(`INSERT INTO difficulty_answers (site, problem_id, client_id, seen, hardest_step, known_reagents, unknown_reagents, created_at)
        VALUES ('onepot', 'p2', ?, ?, ?, ?, ?, ?)`, U(i), seen, hs, JSON.stringify(known), JSON.stringify(unknown), recent('800'));
    }
    assert.equal((await db.prepare('SELECT count(*) n FROM ratings').first()).n, 44);
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
    assert.match(p2[0].created_at, /T12:00:00\.500Z$/);
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

  await t('mech_entries: validated, replaced when sent again, limited to known testers; summary and keyed export', async () => {
    const S = U(900);
    const e = { site: 'mechpilot', visitor: 'aaaaaaaa', session: S, seq: 0, kind: 'arrows', task: 't1-addition', user_level: 'graduate',
      payload: { kind: 'arrows', accepted: 0, submitted: null, strokes: [{ points: [{ x: 1, y: 2 }] }] } };
    assert.equal((await post('/mech_entries', e)).status, 201);
    // the same entry completed later replaces the row
    assert.equal((await post('/mech_entries', { ...e, payload: { ...e.payload, submitted: { match: true } } })).status, 200);
    assert.equal((await post('/mech_entries', { ...e, seq: 1, payload: { kind: 'arrows', accepted: null } })).status, 201);
    assert.equal((await post('/mech_entries', { ...e, seq: 2, kind: 'drawing', task: 't2-diketone', payload: { accepted: false, flagged: 'wrong', wrong: ['letter'] } })).status, 201);
    assert.equal((await post('/mech_entries', { ...e, visitor: 'bbbbbbbb', kind: 'drawing', task: 't2-diketone', payload: { accepted: true, flagged: null } })).status, 201);
    assert.equal((await post('/mech_entries', { ...e, visitor: 'bbbbbbbb', seq: 1, kind: 'questionnaire', task: undefined, payload: { remark: 'private text' } })).status, 201);
    const bad = async (patch, msg) => {
      const r = await post('/mech_entries', { ...e, seq: 50, ...patch });
      assert.equal(r.status, 400, JSON.stringify(patch));
      assert.equal(r.data.error, msg);
    };
    await bad({ site: 'onepot' }, 'invalid site');
    await bad({ visitor: 'cccccccc' }, 'unknown visitor');
    await bad({ visitor: 'XYZ' }, 'invalid visitor');
    await bad({ session: 'abc' }, 'invalid session');
    await bad({ seq: -1 }, 'invalid seq');
    await bad({ kind: 'other' }, 'invalid kind');
    await bad({ user_level: 'expert' }, 'invalid user_level');
    await bad({ payload: 'text' }, 'invalid payload');
    await bad({ payload: { big: 'x'.repeat(250001) } }, 'payload too large');
    assert.equal((await post('/mech_entries', { ...e, payload: { big: 'x'.repeat(260000) } })).data.error, 'body too large');
    assert.equal((await call('GET', '/mech_entries')).status, 405);
    // the other endpoints keep their small body limit
    assert.equal((await post('/results', { site: 'onepot', problem_id: 'p', client_id: U(1), pad: 'x'.repeat(5000) })).data.error, 'body too large');

    assert.deepEqual(await rpc('mech_summary', { p_site: 'mechpilot' }), [
      { task: null, kind: 'questionnaire', entries: 1, visitors: 1, accepted: null, wrong: 0 },
      { task: 't1-addition', kind: 'arrows', entries: 2, visitors: 1, accepted: 1, wrong: 0 },
      { task: 't2-diketone', kind: 'drawing', entries: 2, visitors: 2, accepted: 1, wrong: 1 },
    ]);
    assert.equal((await post('/rpc/mech_summary', { p_site: 'onepot' })).status, 400);
    assert.ok(!JSON.stringify(await rpc('mech_summary', { p_site: 'mechpilot' })).includes('private text'));

    assert.equal((await post('/rpc/mech_export', { p_site: 'mechpilot' })).status, 403);
    const exp = async (key, q = '') => {
      const r = await mf.dispatchFetch('http://localhost/rpc/mech_export?p_site=mechpilot' + q, { headers: { 'X-Export-Key': key } });
      return { status: r.status, data: await r.json() };
    };
    assert.equal((await exp('wrong')).status, 403);
    const out = await exp('test-key');
    assert.equal(out.status, 200);
    assert.equal(out.data.length, 5);
    assert.deepEqual(out.data[0].payload.submitted, { match: true });
    assert.ok(out.data[0].updated_at);
    assert.equal(out.data[4].payload.remark, 'private text');
    assert.equal((await exp('test-key', '&p_since=2999-01-01')).data.length, 0);

    // limit per visitor
    await db.prepare(`INSERT INTO mech_entries (site, visitor, session, seq, kind, payload)
      WITH RECURSIVE c(i) AS (SELECT 100 UNION ALL SELECT i + 1 FROM c WHERE i < 696)
      SELECT 'mechpilot', 'aaaaaaaa', ?, i, 'votes', '{}' FROM c`).bind(S).run();
    assert.equal((await post('/mech_entries', { ...e, seq: 3000 })).status, 429);
    assert.equal((await post('/mech_entries', e)).status, 200);
  });

  console.log(`ALL OK (${n} tests)`);
} finally {
  await mf.dispose();
}
