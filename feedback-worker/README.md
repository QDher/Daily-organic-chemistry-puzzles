# Feedback Worker (Cloudflare Workers + D1)

Shared store for visitors' results, ratings and difficulty answers of both sites:
One-Pot Puzzles (site `onepot`, this repository) and Name Reaction Daily (site `namerxn`,
QDher/Daily-name-reaction-puzzle). It replaces the Supabase project `gevbctklqelyumhynfnq`; the tables,
rules and read functions are those of `supabase/schema.sql`, and the read functions return the same JSON.

| File | Content |
|---|---|
| `src/index.js` | Worker: routes, CORS, inserts, read functions |
| `src/rows.js` | Validation of one row (also used by the import tool) |
| `src/stats.js` | Rounding and median as in Postgres |
| `migrations/` | D1 schema |
| `tools/import_supabase.js` | Copies the Supabase rows into D1 (from the Supabase API or from CSV exports) |
| `test/test.js` | Tests against a local D1 database (`npm test`) |
| `../.github/workflows/feedback-worker.yml` | Tests, then creates the database if needed, applies migrations and deploys |

## Endpoints

Base URL: `https://puzzle-feedback.<account subdomain>.workers.dev`

| Request | Result |
|---|---|
| `POST /results`, `/ratings`, `/difficulty_answers` with a JSON row | `201 {}`; `409 {"error": "duplicate"}` if this visitor already answered this problem; `400 {"error": ...}` if invalid |
| `POST /rpc/<fn>` with `{"p_site": ..., ...}` or `GET /rpc/<fn>?p_site=...` | `200` JSON |

Read functions: `problem_stats` (`p_problem`), `problem_summary`, `feedback_export` (`p_since`, default 120 days ago),
`difficulty_summary`. Browsers can call the Worker only from `ALLOWED_ORIGINS` (`wrangler.toml`); requests without
an `Origin` header (curl in the scheduled tasks) are accepted. Anyone can read `feedback_export`: remarks are not private.

## One-time setup (account owner)

1. Create a free Cloudflare account. Open **Workers & Pages** once; if it asks for a `workers.dev` subdomain, choose one.
2. Copy the **Account ID** (shown in the dashboard on the account home page and in Workers & Pages).
3. Create an API token: profile menu → **API Tokens** → **Create Token** → **Custom token**, permissions
   *Account · Workers Scripts · Edit* and *Account · D1 · Edit*, account resources: this account.
4. In this GitHub repository: **Settings → Secrets and variables → Actions → New repository secret**:
   - `CLOUDFLARE_API_TOKEN`: the token
   - `CLOUDFLARE_ACCOUNT_ID`: the account ID
   - `SUPABASE_SECRET_KEY`: Supabase dashboard → Project Settings → API Keys → secret key (only for the copy of
     the existing rows; delete it after the switch)
5. **Actions → Feedback Worker (Cloudflare) → Run workflow**, with *Copy the rows from Supabase* ticked.
   The log of the *Deploy* step shows the Worker URL; the last step shows the row counts.

Later changes under `feedback-worker/` are deployed by the workflow on each push to `main`.

## Local development

Node.js 22 or later.

```bash
npm ci
npm test
```

`npx wrangler dev` runs the Worker locally with a local D1 database
(apply the schema first with `npx wrangler d1 migrations apply puzzle-feedback --local`).
