// Validation of one visitor row, shared by the Worker (src/index.js) and the import tool
// (tools/import_supabase.js). Same rules as supabase/schema.sql.

export const SITES = ['onepot', 'namerxn'];
export const SEEN = ['undergraduate', 'graduate', 'papers', 'never'];
export const LEVELS = ['undergraduate', 'graduate', 'postgraduate'];
export const VOTES = ['too_easy', 'about_right', 'too_hard'];
export const VERDICTS = ['product', 'intermediate', 'substrate', 'none'];
export const TABLES = ['results', 'ratings', 'difficulty_answers', 'difficulty_votes', 'checks'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class Invalid extends Error {}

const chars = s => Array.from(s).length;
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

function base(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new Invalid('body must be a JSON object');
  if (!SITES.includes(b.site)) throw new Invalid('invalid site');
  if (typeof b.problem_id !== 'string' || chars(b.problem_id) < 1 || chars(b.problem_id) > 120) throw new Invalid('invalid problem_id');
  if (typeof b.client_id !== 'string' || !UUID_RE.test(b.client_id)) throw new Invalid('invalid client_id');
  // level declared by the visitor (optional; absent in rows sent before 2026-11-11 and in imported rows)
  const lv = b.user_level === undefined ? null : b.user_level;
  if (lv !== null && !LEVELS.includes(lv)) throw new Invalid('invalid user_level');
  return { site: b.site, problem_id: b.problem_id, client_id: b.client_id.toLowerCase(), user_level: lv };
}

function reagents(v, field) {
  if (v === undefined || v === null) return '[]';
  if (!Array.isArray(v) || v.length > 6 || v.some(x => typeof x !== 'string') || chars(v.join('|')) > 600) {
    throw new Invalid('invalid ' + field);
  }
  return JSON.stringify(v);
}

// Columns to insert for one row of `table`, with values ready for D1 (integer, text or null).
export function validRow(table, b) {
  const row = base(b);
  switch (table) {
    case 'results':
      if (!isInt(b.checks, 0, 999)) throw new Invalid('invalid checks');
      if (!isInt(b.hints, 0, 30)) throw new Invalid('invalid hints');
      if (!isInt(b.score, 0, 2000)) throw new Invalid('invalid score');
      if (typeof b.revealed !== 'boolean') throw new Invalid('invalid revealed');
      // 1 = every distinct structure counted; 2 = correct intermediates not counted (pages from 2026-11-11)
      const rule = b.score_rule === undefined ? 1 : b.score_rule;
      if (rule !== 1 && rule !== 2) throw new Invalid('invalid score_rule');
      return { ...row, checks: b.checks, hints: b.hints, score: b.score, revealed: b.revealed ? 1 : 0, score_rule: rule };
    case 'ratings': {
      if (!isInt(b.stars, 1, 5)) throw new Invalid('invalid stars');
      const remark = b.remark === undefined ? null : b.remark;
      if (remark !== null && (typeof remark !== 'string' || chars(remark) > 200)) throw new Invalid('invalid remark');
      return { ...row, stars: b.stars, remark };
    }
    case 'difficulty_answers': {
      if (!SEEN.includes(b.seen)) throw new Invalid('invalid seen');
      const hs = b.hardest_step === undefined ? null : b.hardest_step;
      if (hs !== null && !isInt(hs, 1, 20)) throw new Invalid('invalid hardest_step');
      return { ...row, seen: b.seen, hardest_step: hs,
        known_reagents: reagents(b.known_reagents, 'known_reagents'),
        unknown_reagents: reagents(b.unknown_reagents, 'unknown_reagents') };
    }
    case 'difficulty_votes':
      if (!VOTES.includes(b.vote)) throw new Invalid('invalid vote');
      return { ...row, vote: b.vote };
    case 'checks': {
      if (typeof b.key !== 'string' || !b.key.startsWith('InChI=') || chars(b.key) > 2000) throw new Invalid('invalid key');
      if (typeof b.smiles !== 'string' || chars(b.smiles) < 1 || chars(b.smiles) > 1000) throw new Invalid('invalid smiles');
      if (!VERDICTS.includes(b.verdict)) throw new Invalid('invalid verdict');
      const opt = (v, lo, hi, f) => { const x = v === undefined ? null : v; if (x !== null && !isInt(x, lo, hi)) throw new Invalid('invalid ' + f); return x; };
      const step = opt(b.step, 1, 20, 'step'), inter = opt(b.intermediate, 1, 50, 'intermediate');
      if ((b.verdict === 'intermediate') !== (step !== null && inter !== null)) throw new Invalid('invalid step');
      if (!isInt(b.hints, 0, 30)) throw new Invalid('invalid hints');
      return { ...row, key: b.key, smiles: b.smiles, verdict: b.verdict, step, intermediate: inter, hints: b.hints,
        seconds: opt(b.seconds, 0, 864000, 'seconds') };
    }
    default:
      throw new Invalid('unknown table');
  }
}

// UTC time as stored in D1 (ISO 8601 with milliseconds). Accepts ISO dates and the Postgres text
// format of a Supabase export ("2026-11-05 20:03:17.92047+00"). Returns null if not a date.
export function isoTime(v) {
  let s = String(v ?? '').trim();
  if (!s) return null;
  s = s.replace(' ', 'T').replace(/(\.\d{3})\d+/, '$1').replace(/(T[\d:.]+[+-]\d{2})$/, '$1:00');
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString();
}
