// Shared results, ratings and difficulty answers for One-Pot Puzzles (site "onepot") and
// Name Reaction Daily (site "namerxn"): Cloudflare Worker with a D1 database (binding DB).
// It replaced the former Supabase store on 2026-11-11; the read functions return the same JSON as supabase/schema.sql.
//
//   POST /results | /ratings | /difficulty_answers | /difficulty_votes | /checks   JSON body: insert one row
//        (checks: one row per distinct structure, at most MAX_CHECKS per visitor and problem: 429 beyond)
//        201 {} | 409 {"error": "duplicate"} (this visitor already answered this problem) | 400 {"error": ...}
//   POST /rpc/<fn> with a JSON body {"p_site": ..., ...}, or GET /rpc/<fn>?p_site=...   200 JSON
//        problem_stats (p_problem), problem_summary, feedback_export (p_since, default 120 days ago),
//        difficulty_summary, check_clusters (p_min, default 3: wrong structures drawn by at least p_min visitors)
//
//   POST /mech_entries   one entry of the curly-arrow pages (table mech_entries, site "mechpilot"): 201 {} for a new
//        row, 200 {} when a row with the same (site, visitor, session, seq) is replaced; visitors are limited to
//        MECH_TESTERS and to MAX_MECH rows each (429 beyond). Body up to about 260 kB.
//   /rpc/mech_summary (p_site): counts per task and kind, without payloads.
//   /rpc/mech_export (p_site, p_since): the rows with their payloads; only with the header X-Export-Key equal to
//        the Worker secret MECH_EXPORT_KEY (403 otherwise, also when the secret is not set).
//
// Browsers may call it only from ALLOWED_ORIGINS (wrangler.toml); requests without an Origin header
// (curl in the scheduled tasks) are accepted. Anyone can call feedback_export: remarks are not private.
// The visitor's declared level (user_level) and the scoring rule are stored but not returned by the read functions.

import { SITES, TABLES, MECH_SITES, MECH_MAX_PAYLOAD, Invalid, validRow, validMechRow, isoTime } from './rows.js';
import { round2, median } from './stats.js';

const MAX_BODY = 4096;
const DAY_MS = 86400000;
const MAX_CHECKS = 200;
const MAX_MECH = 600;

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const cors = { Vary: 'Origin' };
    if (origin !== null) {
      if (!allowed.includes(origin)) return json({ error: 'origin not allowed' }, 403, cors);
      cors['Access-Control-Allow-Origin'] = origin;
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '86400' } });
    }
    try {
      const { status = 200, data } = await route(request, env.DB, env);
      return json(data, status, cors);
    } catch (e) {
      if (e instanceof Invalid) return json({ error: e.message }, 400, cors);
      console.error(e);
      return json({ error: 'server error' }, 500, cors);
    }
  },
};

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

async function route(request, db, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  if (path === '' && request.method === 'GET') return { data: { service: 'puzzle-feedback' } };
  if (path === '/mech_entries') {
    if (request.method !== 'POST') return { status: 405, data: { error: 'use POST' } };
    return insertMech(db, await readBody(request, MECH_MAX_PAYLOAD + 2000), env);
  }
  const mm = /^\/rpc\/(mech_\w+)$/.exec(path);
  if (mm) {
    if (request.method === 'POST') return mechRpc(db, mm[1], await readBody(request), request, env);
    if (request.method === 'GET') return mechRpc(db, mm[1], Object.fromEntries(url.searchParams), request, env);
    return { status: 405, data: { error: 'use GET or POST' } };
  }
  const table = path.slice(1);
  if (TABLES.includes(table)) {
    if (request.method !== 'POST') return { status: 405, data: { error: 'use POST' } };
    return insert(db, table, await readBody(request));
  }
  const m = /^\/rpc\/(\w+)$/.exec(path);
  if (m) {
    if (request.method === 'POST') return { data: await rpc(db, m[1], await readBody(request)) };
    if (request.method === 'GET') return { data: await rpc(db, m[1], Object.fromEntries(url.searchParams)) };
    return { status: 405, data: { error: 'use GET or POST' } };
  }
  return { status: 404, data: { error: 'not found' } };
}

async function readBody(request, max = MAX_BODY) {
  const text = await request.text();
  if (text.length > max) throw new Invalid('body too large');
  let b;
  try { b = JSON.parse(text); } catch { throw new Invalid('body must be a JSON object'); }
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Invalid('body must be a JSON object');
  return b;
}

async function insert(db, table, body) {
  const row = validRow(table, body);
  if (table === 'checks') {
    const c = await db.prepare('SELECT count(*) AS n FROM checks WHERE site = ? AND problem_id = ? AND client_id = ?')
      .bind(row.site, row.problem_id, row.client_id).first();
    if (c.n >= MAX_CHECKS) return { status: 429, data: { error: 'too many checks' } };
  }
  const conflict = table === 'checks' ? 'site, problem_id, client_id, key' : 'site, problem_id, client_id';
  const cols = Object.keys(row);
  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
               ON CONFLICT (${conflict}) DO NOTHING`;
  const r = await db.prepare(sql).bind(...cols.map(c => row[c])).run();
  if (!r.meta.changes) return { status: 409, data: { error: 'duplicate' } };
  return { status: 201, data: {} };
}

/* ---------- curly-arrow pages ---------- */

async function insertMech(db, body, env) {
  const testers = String(env.MECH_TESTERS || '').split(',').map(s => s.trim()).filter(Boolean);
  const row = validMechRow(body, testers);
  const old = await db.prepare('SELECT id FROM mech_entries WHERE site = ? AND visitor = ? AND session = ? AND seq = ?')
    .bind(row.site, row.visitor, row.session, row.seq).first();
  if (!old) {
    const c = await db.prepare('SELECT count(*) AS n FROM mech_entries WHERE site = ? AND visitor = ?')
      .bind(row.site, row.visitor).first();
    if (c.n >= MAX_MECH) return { status: 429, data: { error: 'too many entries' } };
  }
  const cols = Object.keys(row);
  await db.prepare(`INSERT INTO mech_entries (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
    ON CONFLICT (site, visitor, session, seq) DO UPDATE SET kind = excluded.kind, task = excluded.task,
      user_level = excluded.user_level, accepted = excluded.accepted, flagged = excluded.flagged,
      payload = excluded.payload, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
    .bind(...cols.map(c => row[c])).run();
  return { status: old ? 200 : 201, data: {} };
}

async function mechRpc(db, fn, a, request, env) {
  if (!MECH_SITES.includes(a.p_site)) throw new Invalid('invalid p_site');
  if (fn === 'mech_summary') {
    // per task and kind: entries, visitors, confirmed, flagged as wrong; no payload
    const rows = await all(db, `SELECT task, kind, count(*) AS entries, count(DISTINCT visitor) AS visitors,
        sum(accepted) AS accepted, sum(flagged = 'wrong') AS wrong
      FROM mech_entries WHERE site = ? GROUP BY task, kind ORDER BY task, kind`, a.p_site);
    return { data: rows.map(r => ({ ...r, wrong: r.wrong || 0 })) };
  }
  if (fn === 'mech_export') {
    const key = env.MECH_EXPORT_KEY;
    if (!key || request.headers.get('X-Export-Key') !== key) return { status: 403, data: { error: 'export key required' } };
    const since = a.p_since ? isoTime(a.p_since) : '1970-01-01T00:00:00.000Z';
    if (!since) throw new Invalid('invalid p_since');
    const rows = await all(db, `SELECT id, visitor, session, seq, kind, task, user_level, accepted, flagged, payload,
        created_at, updated_at FROM mech_entries
      WHERE site = ? AND coalesce(updated_at, created_at) >= ? ORDER BY visitor, session, seq`, a.p_site, since);
    return { data: rows.map(r => ({ ...r, payload: JSON.parse(r.payload) })) };
  }
  throw new Invalid('unknown function');
}

/* ---------- read functions ---------- */

function countBy(rows, key) {
  const out = {};
  for (const r of rows) {
    const k = key(r);
    if (k !== null && k !== undefined) out[k] = (out[k] || 0) + 1;
  }
  return out;
}
const sum = xs => xs.reduce((a, b) => a + b, 0);
const sortedIds = rows => [...new Set(rows.map(r => r.problem_id))].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
const all = async (db, sql, ...args) => (await db.prepare(sql).bind(...args).all()).results;

async function rpc(db, fn, a) {
  const site = a.p_site;
  if (!SITES.includes(site)) throw new Invalid('invalid p_site');
  switch (fn) {
    case 'problem_stats': {
      if (typeof a.p_problem !== 'string' || !a.p_problem) throw new Invalid('invalid p_problem');
      const res = await all(db, 'SELECT score, revealed FROM results WHERE site = ? AND problem_id = ?', site, a.p_problem);
      const rat = await all(db, 'SELECT stars FROM ratings WHERE site = ? AND problem_id = ?', site, a.p_problem);
      return {
        solved: countBy(res.filter(r => !r.revealed), r => r.score),
        revealed: res.filter(r => r.revealed).length,
        ratings: { n: rat.length, mean: round2(sum(rat.map(r => r.stars)), rat.length), dist: countBy(rat, r => r.stars) },
      };
    }
    case 'problem_summary': {
      const res = await all(db, 'SELECT problem_id, score, revealed FROM results WHERE site = ?', site);
      const rat = await all(db, 'SELECT problem_id, stars FROM ratings WHERE site = ?', site);
      return sortedIds([...res, ...rat]).map(id => {
        const x = res.filter(r => r.problem_id === id), y = rat.filter(r => r.problem_id === id);
        return { problem_id: id, n_results: x.length, n_revealed: x.filter(r => r.revealed).length,
          median_score: median(x.filter(r => !r.revealed).map(r => r.score)),
          n_ratings: y.length, mean_stars: round2(sum(y.map(r => r.stars)), y.length) };
      });
    }
    case 'feedback_export': {
      const since = a.p_since ? isoTime(a.p_since) : new Date(Date.now() - 120 * DAY_MS).toISOString();
      if (!since) throw new Invalid('invalid p_since');
      const rows = await all(db, `SELECT r.problem_id, r.stars, r.remark, r.created_at, x.score, x.revealed
        FROM ratings r LEFT JOIN results x
          ON x.site = r.site AND x.problem_id = r.problem_id AND x.client_id = r.client_id
        WHERE r.site = ? AND r.created_at >= ? ORDER BY r.created_at, r.id`, site, since);
      return rows.map(r => ({ ...r, revealed: r.revealed === null ? null : !!r.revealed }));
    }
    case 'difficulty_summary': {
      const rows = await all(db, `SELECT problem_id, seen, hardest_step, known_reagents, unknown_reagents
        FROM difficulty_answers WHERE site = ?`, site);
      const votes = await all(db, 'SELECT problem_id, vote FROM difficulty_votes WHERE site = ?', site);
      return sortedIds([...rows, ...votes]).map(id => {
        const d = rows.filter(r => r.problem_id === id);
        const reagents = {};
        const add = (t, k) => { (reagents[t] ??= { known: 0, unknown: 0 })[k]++; };
        for (const r of d) {
          JSON.parse(r.known_reagents).forEach(t => add(t, 'known'));
          JSON.parse(r.unknown_reagents).forEach(t => add(t, 'unknown'));
        }
        const seen = s => d.filter(r => r.seen === s).length;
        const v = votes.filter(r => r.problem_id === id);
        const vote = s => v.filter(r => r.vote === s).length;
        return { problem_id: id, answers: d.length, seen_undergraduate: seen('undergraduate'), seen_graduate: seen('graduate'),
          seen_papers: seen('papers'), seen_never: seen('never'), hardest_step: countBy(d, r => r.hardest_step), reagents,
          votes: { n: v.length, too_easy: vote('too_easy'), about_right: vote('about_right'), too_hard: vote('too_hard') } };
      });
    }
    case 'check_clusters': {
      // structures the page answered "not on the path" for, drawn by at least p_min different visitors
      const min = a.p_min === undefined ? 3 : Number(a.p_min);
      if (!Number.isInteger(min) || min < 2 || min > 1000) throw new Invalid('invalid p_min');
      return all(db, `SELECT problem_id, min(smiles) AS smiles, count(DISTINCT client_id) AS visitors FROM checks
        WHERE site = ? AND verdict = 'none' GROUP BY problem_id, key HAVING count(DISTINCT client_id) >= ?
        ORDER BY problem_id, visitors DESC, smiles`, site, min);
    }
    default:
      throw new Invalid('unknown function');
  }
}
