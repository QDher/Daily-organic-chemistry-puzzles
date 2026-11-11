# Feedback Worker (Cloudflare Workers + D1)

Shared store for visitors' results, ratings and difficulty answers of both sites:
One-Pot Puzzles (site `onepot`, this repository) and Name Reaction Daily (site `namerxn`,
QDher/Daily-name-reaction-puzzle). It replaced the Supabase project `gevbctklqelyumhynfnq` on 2026-11-11 (all its rows
were copied to D1 and checked); the tables, rules and read functions are those of `supabase/schema.sql`, and the
read functions return the same JSON.

| File | Content |
|---|---|
| `src/index.js` | Worker: routes, CORS, inserts, read functions |
| `src/rows.js` | Validation of one row |
| `src/stats.js` | Rounding and median as in Postgres |
| `migrations/` | D1 schema |
| `test/test.js` | Tests against a local D1 database (`npm test`) |
| `../.github/workflows/feedback-worker.yml` | Tests, then creates the database if needed, applies migrations and deploys |

## Endpoints

Base URL: `https://puzzle-feedback.<account subdomain>.workers.dev`

| Request | Result |
|---|---|
| `POST /results`, `/ratings`, `/difficulty_answers`, `/difficulty_votes`, `/checks` with a JSON row | `201 {}`; `409 {"error": "duplicate"}` if this visitor already answered this problem; `400 {"error": ...}` if invalid |
| `POST /rpc/<fn>` with `{"p_site": ..., ...}` or `GET /rpc/<fn>?p_site=...` | `200` JSON |

Read functions: `problem_stats` (`p_problem`), `problem_summary`, `feedback_export` (`p_since`, default 120 days ago),
`difficulty_summary`, `check_clusters` (`p_min`). Browsers can call the Worker only from `ALLOWED_ORIGINS` (`wrangler.toml`); requests without
an `Origin` header (curl in the scheduled tasks) are accepted. Anyone can read `feedback_export`: remarks are not private.

Optional fields (pages from 2026-11-11): `user_level` (`undergraduate`, `graduate`, `postgraduate`) on every row, `score_rule` on results (1 = every distinct structure counted, the default for older rows; 2 = correct intermediates not counted). `difficulty_votes` rows have `vote` (`too_easy`, `about_right`, `too_hard`). The read functions never return `user_level` or `score_rule`; `difficulty_summary` adds `votes` ({n, too_easy, about_right, too_hard}) per problem. Schema change: `migrations/0002_levels_votes_score_rule.sql` (applied by the workflow before the deploy).

`checks` (migration `0003_checks.sql`): one row per site, problem, visitor and distinct structure checked (`key` = comparison key of `src/chemkey.js`, `smiles`, `verdict` = `product` | `intermediate` | `substrate` | `none`, `step` and `intermediate` for a matched intermediate, `hints`, `seconds`, `user_level`); at most 200 rows per visitor and problem (`429` beyond). Read function `check_clusters` (`p_min`, default 3, at least 2): structures answered `none`, grouped by key, drawn by at least `p_min` visitors: `[{problem_id, smiles, visitors}]`. Used by `src/tier_a.py` (Tier A, step 3c of the scheduled runs).

## One-time setup (account owner)

1. Create a free Cloudflare account. Open **Workers & Pages** once; if it asks for a `workers.dev` subdomain, choose one.
2. Copy the **Account ID** (shown in the dashboard on the account home page and in Workers & Pages).
3. Create an API token: profile menu → **API Tokens** → **Create Token** → **Custom token**, permissions
   *Account · Workers Scripts · Edit* and *Account · D1 · Edit*, account resources: this account.
4. In this GitHub repository: **Settings → Secrets and variables → Actions → New repository secret**:
   - `CLOUDFLARE_API_TOKEN`: the token
   - `CLOUDFLARE_ACCOUNT_ID`: the account ID
5. **Actions → Feedback Worker (Cloudflare) → Run workflow**. The log of the *Deploy* step shows the Worker URL.

Later changes under `feedback-worker/` are deployed by the workflow on each push to `main`.

## Local development

Node.js 22 or later.

```bash
npm ci
npm test
```

`npx wrangler dev` runs the Worker locally with a local D1 database
(apply the schema first with `npx wrangler d1 migrations apply puzzle-feedback --local`).
