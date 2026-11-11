// Shared results, ratings and difficulty answers for One-Pot Puzzles (site "onepot") and
// Name Reaction Daily (site "namerxn"): Cloudflare Worker with a D1 database (binding DB).
// Replaces the Supabase project; the read functions return the same JSON as supabase/schema.sql.
//
//   POST /results | /ratings | /difficulty_answers | /difficulty_votes   JSON body: insert one row
//        201 {} | 409 {"error": "duplicate"} (this visitor already answered this problem) | 400 {"error": ...}
//   POST /rpc/<fn> with a JSON body {"p_site": ..., ...}, or GET /rpc/<fn>?p_site=...   200 JSON
//        problem_stats (p_problem), problem_summary, feedback_export (p_since, default 120 days ago),
//        difficulty_summary
//
// Browsers may call it only from ALLOWED_ORIGINS (wrangler.toml); requests without an Origin header
// (curl in the scheduled tasks) are accepted. Anyone can call feedback_export: remarks are not private.
// The visitor's declared level (user_level) and the scoring rule are stored but not returned by the read functions.

import { SITES, TABLES, Invalid, validRow, isoTime } from './rows.js';
import { round2, median } from './stats.js';

const MAX_BODY = 4096;
const DAY_MS = 86400000;

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
      const { status = 200, data } = await route(request, env.DB);
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

async function route(request, db) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '');
  if (path === '' && request.method === 'GET') return { data: { service: 'puzzle-feedback' } };
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

async function readBody(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw new Invalid('body too large');
  let b;
  try { b = JSON.parse(text); } catch { throw new Invalid('body must be a JSON object'); }
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Invalid('body must be a JSON object');
  return b;
}

async function insert(db, table, body) {
  const row = validRow(table, body);
  const cols = Object.keys(row);
  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})
               ON CONFLICT (site, problem_id, client_id) DO NOTHING`;
  const r = await db.prepare(sql).bind(...cols.map(c => row[c])).run();
  if (!r.meta.changes) return { status: 409, data: { error: 'duplicate' } };
  return { status: 201, data: {} };
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
    default:
      throw new Invalid('unknown function');
  }
}
