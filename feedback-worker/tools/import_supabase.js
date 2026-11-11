#!/usr/bin/env node
// Copies the rows of the Supabase tables results, ratings and difficulty_answers into SQL for D1.
//
//   From Supabase directly (used by .github/workflows/feedback-worker.yml; needs the project's secret key):
//     SUPABASE_URL=https://<project>.supabase.co SUPABASE_SECRET_KEY=... node tools/import_supabase.js --from-supabase > import.sql
//   From CSV exports (each file's table is recognized from its header; column order does not matter):
//     node tools/import_supabase.js results.csv ratings.csv difficulty_answers.csv > import.sql
//   then: npx wrangler d1 execute puzzle-feedback --remote --file import.sql
//
// Rows are validated with the Worker's rules; invalid rows are skipped and counted on stderr.
// Rows already present (same site, problem and visitor) are left unchanged (INSERT OR IGNORE), so the
// import can be repeated. import.sql and the CSV files contain visitor remarks: do not commit them,
// and never print their content.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validRow, isoTime, Invalid } from '../src/rows.js';

// RFC 4180: quoted fields, doubled quotes, line breaks inside quotes, CRLF or LF.
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1 || r[0] !== '');
}

// A text[] value as exported: JSON array (["a","b"]), Postgres array literal ({a,"b c"}) or empty.
export function parseList(s) {
  if (Array.isArray(s)) return s;
  s = String(s ?? '').trim();
  if (!s) return [];
  if (s[0] === '[') return JSON.parse(s);
  if (s[0] !== '{' || s[s.length - 1] !== '}') throw new Invalid('invalid list');
  const out = [], body = s.slice(1, -1);
  let cur = '', quoted = false, wasQuoted = false;
  const push = () => { if (wasQuoted || cur.trim() !== 'NULL') out.push(wasQuoted ? cur : cur.trim()); cur = ''; wasQuoted = false; };
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) {
      if (c === '\\') cur += body[++i] ?? '';
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') { quoted = true; wasQuoted = true; }
    else if (c === ',') push();
    else cur += c;
  }
  if (body.length) push();
  return out;
}

const int = s => (/^\s*\d+\s*$/.test(s) ? Number(s) : s);
const bool = s => (/^(true|t)$/i.test(String(s).trim()) ? true : /^(false|f)$/i.test(String(s).trim()) ? false : s);
const orNull = s => (s === '' || s === undefined ? null : s);

const TABLE_OF = header => (header.includes('checks') ? 'results' : header.includes('stars') ? 'ratings'
  : header.includes('seen') ? 'difficulty_answers' : null);

function body(table, o) {
  const b = { site: o.site, problem_id: o.problem_id, client_id: o.client_id };
  if (table === 'results') Object.assign(b, { checks: int(o.checks), hints: int(o.hints), score: int(o.score), revealed: bool(o.revealed) });
  if (table === 'ratings') Object.assign(b, { stars: int(o.stars), remark: orNull(o.remark) });
  if (table === 'difficulty_answers') {
    Object.assign(b, { seen: o.seen, hardest_step: o.hardest_step === '' ? null : int(o.hardest_step),
      known_reagents: parseList(o.known_reagents), unknown_reagents: parseList(o.unknown_reagents) });
  }
  return b;
}

const sqlValue = v => (v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

// One table's rows (objects from a CSV file, all values text, or from the Supabase REST API, typed values)
// into INSERT statements. Adds to `out` and returns {rows, skipped, errors: [{line, reason}]}.
export function rowsToSql(table, objects, out, firstLine = 1) {
  const c = { rows: 0, skipped: 0, errors: [] };
  objects.forEach((o, i) => {
    try {
      const row = validRow(table, body(table, o));
      const created = isoTime(o.created_at);
      if (!created) throw new Invalid('invalid created_at');
      row.created_at = created;
      const cols = Object.keys(row);
      out.push(`INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(k => sqlValue(row[k])).join(', ')});`);
      c.rows++;
    } catch (e) {
      if (!(e instanceof Invalid) && !(e instanceof SyntaxError)) throw e;
      c.skipped++;
      c.errors.push({ line: firstLine + i, reason: e.message });
    }
  });
  return c;
}

// texts: CSV file contents. Returns {sql, counts: {table: {rows, skipped}}, errors: [{table, line, reason}]}.
export function toSql(texts) {
  const out = [], counts = {}, errors = [];
  for (const text of texts) {
    const [header, ...rows] = parseCsv(text);
    const head = header.map(h => h.trim());
    const table = TABLE_OF(head);
    if (!table) throw new Error('unrecognized CSV header: ' + head.join(','));
    const r = rowsToSql(table, rows.map(v => Object.fromEntries(head.map((h, j) => [h, v[j] ?? '']))), out, 2);
    const c = (counts[table] ??= { rows: 0, skipped: 0 });
    c.rows += r.rows; c.skipped += r.skipped;
    errors.push(...r.errors.map(e => ({ table, ...e })));
  }
  return { sql: out.join('\n') + '\n', counts, errors };
}

// All rows of the three tables through the Supabase REST API (the secret key bypasses row level security).
export async function fromSupabase(url, key) {
  const headers = { apikey: key };
  if (key.startsWith('eyJ')) headers.Authorization = 'Bearer ' + key;
  const out = [], counts = {}, errors = [];
  for (const table of ['results', 'ratings', 'difficulty_answers']) {
    const objects = [];
    for (let offset = 0; ; offset += 1000) {
      const r = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${table}?select=*&order=id&limit=1000&offset=${offset}`, { headers });
      if (!r.ok) throw new Error(`Supabase ${table}: HTTP ${r.status}`);
      const page = await r.json();
      objects.push(...page);
      if (page.length < 1000) break;
    }
    const c = rowsToSql(table, objects, out);
    counts[table] = { rows: c.rows, skipped: c.skipped };
    errors.push(...c.errors.map(e => ({ table, line: 'row ' + e.line, reason: e.reason })));
  }
  return { sql: out.join('\n') + '\n', counts, errors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let res;
  if (args[0] === '--from-supabase') {
    const { SUPABASE_URL, SUPABASE_SECRET_KEY } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SECRET_KEY) {
      console.error('set SUPABASE_URL and SUPABASE_SECRET_KEY');
      process.exit(2);
    }
    res = await fromSupabase(SUPABASE_URL, SUPABASE_SECRET_KEY);
  } else if (args.length) {
    res = toSql(args.map(f => fs.readFileSync(f, 'utf8')));
  } else {
    console.error('usage: node tools/import_supabase.js --from-supabase | <results.csv> <ratings.csv> <difficulty_answers.csv>');
    process.exit(2);
  }
  process.stdout.write(res.sql);
  for (const [t, c] of Object.entries(res.counts)) console.error(`${t}: ${c.rows} rows, ${c.skipped} skipped`);
  for (const e of res.errors) console.error(`  skipped ${e.table} ${typeof e.line === 'number' ? 'line ' + e.line : e.line}: ${e.reason}`);
}
