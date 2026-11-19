# Agent-attempt trial (one week, data only)

Proposal 6 of `ML_PLAN.md`, decided by the user on 2026-11-19: four AI agents attempt the daily problems of One-Pot
Puzzles and Name Reaction Daily as a visitor would, to generate data. The trial never chooses, edits, curates or
publishes problems; the daily scheduled tasks are unchanged.

| Item | Value |
|---|---|
| Run by | Scheduled task "Agent attempts trial (Claude Code)" (`trig_019fhPftvU5XeeW4214WAB5q`), nightly at 23:17 America/New_York, 2026-11-19 to 2026-11-25 (the run stops by itself after that date) |
| Problems per night | the sets dated the next day on both sites (new; before visitors see them) and a backlog of older problems with visitor results, not yet attempted (3 One-Pot, 1 Name Reaction Daily) |
| Agents (`agents.json`) | `haiku-product`, `sonnet-product`, `opus-product` (aim for the product), `opus-mechanism` (intermediates in order, then the product) |
| What an agent sees | only what the page shows before solving (`trial.py statement`): substrate, reagents, conditions, steps, number of intermediates, number of hints, level |
| Rules for agents (`AGENT_PROMPT.md`) | no tools (no files, shell or web); one JSON reply per round, up to 5 structures; at most 3 rounds; hints on request |
| Referee (`verdict.js`) | the page's own comparison (`src/chemkey.js`); score as on the page (rule 2: correct intermediates not counted, hint k adds k) |
| Data | `data/attempts.jsonl`: one line per attempt (agent, model, structures and verdicts, checks, hints, score, intermediates found, name guess on Name Reaction Daily, tool uses reported by the Agent tool, the agent's one-sentence notes, visitors' results for that problem at the time) |
| Review | after the week: first the user (answers and data), then Claude (`python3 trial/agents/trial.py summary`); decision: implement, modify or drop |

Tool uses: the Agent tool reports how many tools each agent used; it is recorded with each attempt
(`--tool-uses`). An attempt with tool uses is kept but flagged, since the agent could have looked the answer up.

Not tested before the first night: the full scheduled run (several agents, both sites, push to `main`).
