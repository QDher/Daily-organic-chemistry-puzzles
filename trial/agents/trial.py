#!/usr/bin/env python3
"""Agent-attempt trial (ML_PLAN.md, proposal 6; decided by the user 2026-11-19): four AI agents attempt the newest
daily problems of One-Pot Puzzles and Name Reaction Daily, plus older problems that visitors already solved, as a
visitor would. Data only: nothing here chooses, edits or publishes problems. Run by the scheduled task
"Agent attempts trial (Claude Code)" for one week; reviewed by the user, then by Claude.

Commands (paths: --onepot <clone of QDher/Daily-organic-chemistry-puzzles>, --namerxn <clone of
QDher/Daily-name-reaction-puzzle>):
  select     problems for one night: the sets dated --date (new) and a backlog of older problems with visitor results
             that no agent attempted yet (--backlog-onepot, --backlog-namerxn); JSON on stdout
  statement  what a visitor sees before solving (substrate, reagents, conditions, steps, intermediate slots, number of
             hints, level); --agent AGENT_ID fills trial/agents/AGENT_PROMPT.md; --single gives the one-reply variant
  check      verdicts for one agent reply (--reply-file); creates or updates the attempt file (--attempt)
  hint       next hint of an attempt (atom-mapped SMILES of the substrate or reagent)
  finish     appends the attempt to trial/agents/data/attempts.jsonl
  summary    per agent and per problem, with the visitors' scores recorded at the time of each attempt
  self-test  checks the referee, the scoring, hints and name matching on a built-in problem
"""
import argparse
import datetime
import gzip
import json
import os
import re
import subprocess
import sys
import tempfile
import unicodedata
from statistics import median

from rdkit import Chem, RDLogger

RDLogger.DisableLog("rdApp.*")
HERE = os.path.dirname(os.path.abspath(__file__))
ATTEMPTS = os.path.join(HERE, "data", "attempts.jsonl")
MAX_ROUNDS, PER_ROUND, SINGLE_MAX = 3, 5, 10
SITES = {"onepot": "One-Pot Puzzles", "namerxn": "Name Reaction Daily"}


# ---------- problems ----------
def load_sets(repo):
    sets = json.load(open(os.path.join(repo, "data", "problems.json"), encoding="utf-8"))["sets"]
    arch = os.path.join(repo, "data", "archive.json.gz")
    if os.path.exists(arch):
        sets = json.load(gzip.open(arch, "rt", encoding="utf-8"))["sets"] + sets
    return sets


def find(a, site, pid):
    for s in load_sets(a.onepot if site == "onepot" else a.namerxn):
        for p in s["problems"]:
            if p["id"] == pid:
                return s["date"], p
    sys.exit(f"problem {pid} not found on {site}")


def statement_text(site, p):
    lines = [f"Site: {SITES[site]}." + (f" Level: {p['level']}." if p.get("level") else ""),
             f"Substrate: {p['substrate']['label']}. SMILES: {p['substrate']['smiles']}",
             f"One pot, {len(p['steps'])} step(s):"]
    for st in p["steps"]:
        reag = "; ".join(r["text"] + (f" (SMILES: {r['smiles']})" if r.get("smiles") else "") for r in st["reagents"]) or "no added reagent"
        cond = st.get("conditions") or ""
        lines.append(f"  Step {st['n']}: {reag}" + (f". Conditions: {cond}" if cond and cond != "see SI" else "")
                     + f". The mechanism of this step has {len(st['intermediates'])} intermediate(s) to find.")
    lines.append(f"Hints available: {len(p.get('hints', []))}.")
    goal = "Find the product. Intermediates of the mechanism can be checked too."
    if site == "namerxn":
        goal += ' Also name the reaction (field "name"; name tries do not change the score).'
    lines.append(goal)
    return "\n".join(lines)


def species(p):
    inter = [{"step": st["n"], "k": k + 1, "forms": it["forms"]} for st in p["steps"] for k, it in enumerate(st["intermediates"])]
    return {"substrate": p["substrate"]["smiles"], "product": p["product"]["smiles"], "intermediates": inter}


def referee(a, p, smiles):
    q = dict(species(p), smiles=smiles)
    r = subprocess.run(["node", os.path.join(HERE, "verdict.js")], input=json.dumps(q), capture_output=True, text=True,
                       cwd=a.onepot)
    if r.returncode:
        sys.exit("referee failed: " + r.stderr[-500:])
    return json.loads(r.stdout)


# ---------- name matching (same rule as the Name Reaction Daily page) ----------
STOP = {"reaction", "the", "rxn"}


def norm_name(s):
    s = "".join(c for c in unicodedata.normalize("NFD", str(s)) if not unicodedata.combining(c)).lower()
    s = re.sub(r"[‐-―−-]", " ", s)
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return " ".join(w for w in s.split() if w and w not in STOP)


def lev(a, b):
    d = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(b) + 1):
            t = d[j]
            d[j] = min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] != b[j - 1]))
            prev = t
    return d[len(b)]


def name_matches(guess, names):
    g = norm_name(guess)
    if not g:
        return False
    for n in names:
        t = norm_name(n)
        tol = 2 if len(t) >= 14 else 1 if len(t) >= 7 else 0
        if g == t or lev(g, t) <= tol:
            return True
    return False


# ---------- attempts ----------
def penalty(h):
    return h * (h + 1) // 2


def parse_reply(path):
    text = open(path, encoding="utf-8").read()
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return None
    try:
        r = json.loads(m.group(0))
    except json.JSONDecodeError:
        return None
    if not isinstance(r.get("structures"), list) or not all(isinstance(s, str) for s in r["structures"]):
        return None
    return r


def verdict_text(v, p):
    if v["verdict"] == "product":
        return "product: correct"
    if v["verdict"] == "intermediate":
        st = next(s for s in p["steps"] if s["n"] == v["step"])
        return f"correct intermediate: step {v['step']}, intermediate {v['k']} of {len(st['intermediates'])}"
    return {"substrate": "this is the substrate", "none": "not the product or an intermediate of the mechanism",
            "unreadable": "unreadable SMILES"}[v["verdict"]]


def cmd_check(a):
    date, p = find(a, a.site, a.id)
    agents = {x["id"]: x for x in json.load(open(os.path.join(HERE, "agents.json")))["agents"]}
    if os.path.exists(a.attempt):
        att = json.load(open(a.attempt))
    else:
        if a.agent not in agents:
            sys.exit("unknown agent " + str(a.agent))
        att = {"site": a.site, "problem_id": a.id, "problem_date": date, "kind": a.kind, "agent": a.agent,
               "model": agents[a.agent]["model"], "mode": "single" if a.single else "interactive",
               "started": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
               "rounds": [], "checked_keys": [], "found": [], "checks": 0, "hints": 0, "solved": False,
               "name_guesses": [], "name_correct": False, "invalid_replies": 0, "notes": [], "tools_reported": [],
               "tool_uses": 0, "reformatted_replies": 0}
    if att["solved"]:
        sys.exit("attempt already solved")
    limit_rounds = 1 if att["mode"] == "single" else MAX_ROUNDS
    if len(att["rounds"]) >= limit_rounds:
        sys.exit("no rounds left")
    att["tool_uses"] = att.get("tool_uses", 0) + (a.tool_uses or 0)   # as reported by the Agent tool for this reply
    if a.reformatted:                     # the agent answered in prose; the run copied this round's structures into JSON
        att["reformatted_replies"] = att.get("reformatted_replies", 0) + 1
    reply = parse_reply(a.reply_file)
    if reply is None:
        att["invalid_replies"] += 1
        json.dump(att, open(a.attempt, "w"))
        print(json.dumps({"valid": False, "message": "Reply was not a JSON object with a \"structures\" list. Reply again with one JSON object only."}))
        return
    per = SINGLE_MAX if att["mode"] == "single" else PER_ROUND
    structs = [s.strip() for s in reply["structures"] if s.strip()][:per]
    verdicts = referee(a, p, structs) if structs else []
    rnd = {"structures": [], "hint_requested": bool(reply.get("hint"))}
    for v in verdicts:
        counted = False
        if v["verdict"] == "intermediate":
            fid = f"{v['step']}.{v['k']}"
            if fid not in att["found"]:
                att["found"].append(fid)
        elif v["key"] and v["key"] not in att["checked_keys"]:
            att["checked_keys"].append(v["key"])
            att["checks"] += 1
            counted = True
        # an unreadable drawing is not counted (the page answers "Unreadable" without counting it)
        rnd["structures"].append({"smiles": v["smiles"], "verdict": v["verdict"], "step": v.get("step"), "k": v.get("k"), "counted": counted})
        if v["verdict"] == "product":
            att["solved"] = True
            break                         # a visitor stops at the product
    if a.site == "namerxn" and reply.get("name"):
        att["name_guesses"].append(str(reply["name"])[:120])
        att["name_correct"] = att["name_correct"] or name_matches(reply["name"], p.get("names", []))
    att["rounds"].append(rnd)
    if reply.get("note"):
        att["notes"].append(str(reply["note"])[:300])
    att["tools_reported"].append(str(reply.get("tools_used", ""))[:40])
    json.dump(att, open(a.attempt, "w"))
    left = limit_rounds - len(att["rounds"])
    lines = [f"{i + 1}. {s['smiles']}: {verdict_text(v, p)}" + ("" if s["counted"] else " (not counted)")
             for i, (s, v) in enumerate(zip(rnd["structures"], verdicts))]
    if a.site == "namerxn" and reply.get("name"):
        lines.append(f"Name: {'correct' if name_matches(reply['name'], p.get('names', [])) else 'not the expected name'}.")
    status = "solved" if att["solved"] else ("rounds used up" if left == 0 else f"{left} round(s) left")
    lines.append(f"Score so far: {att['checks'] + penalty(att['hints'])}. Status: {status}.")
    print(json.dumps({"valid": True, "solved": att["solved"], "rounds_left": left, "hint_requested": rnd["hint_requested"],
                      "message": "\n".join(lines)}))


def mapped(smiles, atom):
    m = Chem.MolFromSmiles(smiles)
    m.GetAtomWithIdx(atom).SetAtomMapNum(1)
    return Chem.MolToSmiles(m, canonical=False)


def cmd_hint(a):
    att = json.load(open(a.attempt))
    _, p = find(a, att["site"], att["problem_id"])
    hints = p.get("hints", [])
    if att["hints"] >= len(hints):
        print(json.dumps({"message": "No more hints."}))
        return
    h = hints[att["hints"]]
    att["hints"] += 1
    if h["mol"] == "substrate":
        smi, what = p["substrate"]["smiles"], "the substrate"
    else:
        st = next(s for s in p["steps"] if s["n"] == h.get("step", 1))
        r = next(r for r in st["reagents"] if r["text"] == h["reagent"])
        smi, what = r["smiles"], f"the reagent {h['reagent']}"
    json.dump(att, open(a.attempt, "w"))
    print(json.dumps({"message": f"Hint {att['hints']} of {len(hints)} (adds {att['hints']} to the score): in {what}, "
                                 f"the atom with map number 1 in {mapped(smi, h['atom'])} has a bond made or broken."}))


def human_snapshot(a, site, pid):
    f = a.summary_onepot if site == "onepot" else a.summary_namerxn
    if not f or not os.path.exists(f):
        return None
    try:
        rows = {r["problem_id"]: r for r in json.load(open(f))}
    except (json.JSONDecodeError, TypeError):
        return None
    r = rows.get(pid)
    return {k: r[k] for k in ("n_results", "n_revealed", "median_score", "n_ratings", "mean_stars")} if r else {"n_results": 0}


def cmd_finish(a):
    att = json.load(open(a.attempt))
    _, p = find(a, att["site"], att["problem_id"])
    total = sum(len(st["intermediates"]) for st in p["steps"])
    rec = {"run_date": datetime.datetime.now(datetime.timezone.utc).date().isoformat(), **{k: att[k] for k in (
        "site", "problem_id", "problem_date", "kind", "agent", "model", "mode", "started")},
        "solved": att["solved"], "rounds": len(att["rounds"]), "checks": att["checks"], "hints": att["hints"],
        "score": att["checks"] + penalty(att["hints"]) if att["solved"] else None,
        "intermediates_found": len(att["found"]), "intermediates_total": total,
        "name_correct": att["name_correct"] if att["site"] == "namerxn" else None,
        "name_tries": len(att["name_guesses"]) if att["site"] == "namerxn" else None,
        "invalid_replies": att["invalid_replies"], "ended": a.ended or ("solved" if att["solved"] else "rounds used up"),
        "tools_reported": sorted(set(att["tools_reported"])), "tool_uses": att.get("tool_uses", 0),
        "reformatted_replies": att.get("reformatted_replies", 0), "notes": att["notes"],
        "structures": [s for r in att["rounds"] for s in r["structures"]],
        "humans_at_attempt": human_snapshot(a, att["site"], att["problem_id"])}
    os.makedirs(os.path.dirname(ATTEMPTS), exist_ok=True)
    with open(ATTEMPTS, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
    print(json.dumps({"recorded": True, "solved": rec["solved"], "score": rec["score"]}))


def attempted():
    if not os.path.exists(ATTEMPTS):
        return set()
    return {(json.loads(l)["site"], json.loads(l)["problem_id"]) for l in open(ATTEMPTS, encoding="utf-8") if l.strip()}


def cmd_select(a):
    done, out = attempted(), []
    for site, repo, n, summ in (("onepot", a.onepot, a.backlog_onepot, a.summary_onepot),
                                ("namerxn", a.namerxn, a.backlog_namerxn, a.summary_namerxn)):
        sets = load_sets(repo)
        for s in sets:
            if s["date"] == a.date:
                out += [{"site": site, "id": p["id"], "date": s["date"], "kind": "new"} for p in s["problems"] if (site, p["id"]) not in done]
        try:
            res = {r["problem_id"]: r["n_results"] for r in json.load(open(summ))} if summ else {}
        except (OSError, json.JSONDecodeError):
            res = {}
        older = [(res.get(p["id"], 0), s["date"], p["id"]) for s in sets if s["date"] < a.date for p in s["problems"]
                 if (site, p["id"]) not in done and res.get(p["id"], 0) >= 2]
        older.sort(key=lambda t: (-t[0], t[1]))
        out += [{"site": site, "id": pid, "date": d, "kind": "backlog", "visitor_results": nres} for nres, d, pid in older[:n]]
    print(json.dumps(out, indent=1))


def cmd_statement(a):
    _, p = find(a, a.site, a.id)
    text = statement_text(a.site, p)
    if not a.agent:
        print(text)
        return
    ag = {x["id"]: x for x in json.load(open(os.path.join(HERE, "agents.json")))["agents"]}[a.agent]
    tpl = open(os.path.join(HERE, "AGENT_PROMPT.md"), encoding="utf-8").read()
    fill = {"{STRATEGY}": ag["strategy"], "{STATEMENT}": text,
            "{NAMEFIELD}": '"name": "reaction name", ' if a.site == "namerxn" else "",
            "{PERROUND}": (f"up to {SINGLE_MAX} structures in your single reply, in the order you would check them" if a.single
                           else f"1 to {PER_ROUND} structures per reply, in the order you would check them"),
            "{ROUNDS}": ("You have one reply only; hints are not available in this mode." if a.single
                         else f"You have at most {MAX_ROUNDS} replies; after each one you receive the verdicts.")}
    for k, v in fill.items():
        tpl = tpl.replace(k, v)
    print(tpl)


def cmd_summary(a):
    rows = [json.loads(l) for l in open(ATTEMPTS, encoding="utf-8") if l.strip()] if os.path.exists(ATTEMPTS) else []
    by_agent = {}
    for r in rows:
        by_agent.setdefault(r["agent"], []).append(r)
    out = {"attempts": len(rows), "problems": len({(r["site"], r["problem_id"]) for r in rows}), "agents": {}}
    for ag, rs in sorted(by_agent.items()):
        solved = [r for r in rs if r["solved"]]
        out["agents"][ag] = {"attempts": len(rs), "solved": len(solved),
                             "median_score": median([r["score"] for r in solved]) if solved else None,
                             "hints": sum(r["hints"] for r in rs), "invalid_replies": sum(r["invalid_replies"] for r in rs),
                             "attempts_with_tool_uses": sum(1 for r in rs if r.get("tool_uses")),
                             "tools_reported": sorted({t for r in rs for t in r["tools_reported"] if t and t != "none"})}
    pairs = [(r["score"], r["humans_at_attempt"]["median_score"]) for r in rows
             if r["solved"] and r.get("humans_at_attempt") and r["humans_at_attempt"].get("median_score") is not None]
    out["pairs_with_visitor_median"] = len(pairs)
    print(json.dumps(out, indent=1))


def cmd_self_test(a):
    p = {"id": "t", "substrate": {"label": "acetaldehyde", "smiles": "CC=O"},
         "steps": [{"n": 1, "reagents": [{"text": "NH3", "smiles": "N"}, {"text": "HCN", "smiles": "C#N"}], "conditions": "",
                    "intermediates": [{"label": "imine", "forms": ["CC=N"]}, {"label": "aminonitrile", "forms": ["CC(N)C#N"]}]}],
         "product": {"smiles": "CC(N)C(=O)O"}, "hints": [{"mol": "substrate", "atom": 1}], "names": ["Strecker synthesis", "Strecker reaction"]}
    v = referee(a, p, ["CC=N", "CCO", "CC(N)C(=O)O", "CC=O", "xx"])
    assert [x["verdict"] for x in v] == ["intermediate", "none", "product", "substrate", "unreadable"], v
    assert mapped("CC=O", 1) == "C[CH:1]=O", mapped("CC=O", 1)
    assert name_matches("strecker synthesis", p["names"]) and name_matches("Strecker reaction", p["names"])
    assert name_matches("Strecker", p["names"])       # "Strecker reaction" reduces to "strecker" (stop word), as on the page
    assert not name_matches("Strecker", ["Strecker synthesis"])
    assert name_matches("Strecker amino acid synthesis", ["Strecker amino acid synthesis"]) and not name_matches("Ugi", p["names"])
    assert "intermediate(s) to find" in statement_text("namerxn", p) and "CC(N)C(=O)O" not in statement_text("namerxn", p)
    print("OK")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("command", choices=["select", "statement", "check", "hint", "finish", "summary", "self-test"])
    ap.add_argument("--onepot", default=os.path.normpath(os.path.join(HERE, "..", "..")))
    ap.add_argument("--namerxn", default=os.path.normpath(os.path.join(HERE, "..", "..", "..", "Daily-name-reaction-puzzle")))
    ap.add_argument("--site", choices=list(SITES))
    ap.add_argument("--id")
    ap.add_argument("--agent")
    ap.add_argument("--kind", default="new", choices=["new", "backlog"])
    ap.add_argument("--attempt")
    ap.add_argument("--reply-file")
    ap.add_argument("--single", action="store_true")
    ap.add_argument("--ended")
    ap.add_argument("--tool-uses", type=int, default=0, help="tool uses reported by the Agent tool for this reply")
    ap.add_argument("--reformatted", action="store_true", help="the reply was prose; the run wrote this round's structures as JSON")
    ap.add_argument("--date")
    ap.add_argument("--summary-onepot")
    ap.add_argument("--summary-namerxn")
    ap.add_argument("--backlog-onepot", type=int, default=3)
    ap.add_argument("--backlog-namerxn", type=int, default=1)
    a = ap.parse_args()
    {"select": cmd_select, "statement": cmd_statement, "check": cmd_check, "hint": cmd_hint, "finish": cmd_finish,
     "summary": cmd_summary, "self-test": cmd_self_test}[a.command](a)


if __name__ == "__main__":
    main()
