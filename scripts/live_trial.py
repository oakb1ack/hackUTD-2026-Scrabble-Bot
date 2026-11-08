#!/usr/bin/env python3
"""Archive a trial with settings fixed per match while the bot keeps playing."""
import argparse
import json
import pathlib
import re
import statistics
import time
from datetime import datetime, timezone

from competitors import US, sql


def capture(mid):
    parts = sql(f"SELECT bot_id, score, balance FROM match_participant WHERE match_id = {mid}")
    own = next(r for r in parts if int(r[0]) == US)
    auctions = sql(f"SELECT auction_id, letter, winner_bot_id, paid, closed_at FROM auction_result WHERE match_id = {mid}")
    words = sql(f"SELECT bot_id, word, total_reward, played_at FROM word_play WHERE match_id = {mid}")
    buys = [r for r in auctions if re.search(r"\d+", r[2]) and int(re.search(r"\d+", r[2]).group()) == US]
    own_words = sorted((r for r in words if int(r[0]) == US), key=lambda r: r[3])
    windows = []
    for word in own_words:
        after = sorted((r for r in auctions if r[4] > word[3]), key=lambda r: r[4])
        cash_after = 100 + sum(int(r[2]) for r in own_words if r[3] <= word[3]) - sum(int(r[3]) for r in buys if r[4] <= word[3])
        if int(word[2]) >= 20 and cash_after >= 25 and 10 <= len(after) <= 37:
            purchases = sum(r in buys for r in after[:10])
            windows.append({"word": word[1], "cash_after": cash_after,
                            "offers": 10, "purchases": purchases})
    return {
        "match": mid, "place": 1 + sum(int(r[1]) > int(own[1]) for r in parts),
        "players": len(parts), "score": int(own[1]), "cash": int(own[2]),
        "tiles": len(buys), "spent": sum(int(r[3]) for r in buys),
        "words": [[r[1], int(r[2])] for r in own_words],
        "refill_windows": windows,
        "participants": parts, "auctions": auctions, "word_plays": words,
    }


def render(state, out):
    rows = state["results"]
    lines = ["# Live strategy trial", "", state["description"], "",
             f"Completed: {len(rows)}/{state['target']}. Only ended matches after {state['since']} are included.",
             "The transition game and all earlier games are excluded. Each match keeps its assigned settings; profiles may alternate between matches.",
             "Tied scores share a place. Different opponent lineups and starting racks prevent a controlled causal comparison.", "",
             "| Trial game | Match ID | Profile | Place | Score | Purchases | Spent | Cash left | Words |",
             "|---|---:|---|---:|---:|---:|---:|---:|---|"]
    for number, r in enumerate(rows, 1):
        words = ", ".join(f"{w} ({v})" for w, v in r["words"])
        lines.append(f"| {number}/{state['target']} | {r['match']} | {r.get('profile', 'fixed')} | {r['place']}/{r['players']} | {r['score']} | {r['tiles']} | {r['spent']} | {r['cash']} | {words} |")
    if rows:
        lines += ["", f"Wins: {sum(r['place'] == 1 for r in rows)}/{len(rows)}. Top three: {sum(r['place'] <= 3 for r in rows)}/{len(rows)}.",
                  f"Average score: {statistics.mean(r['score'] for r in rows):.1f}; average place: {statistics.mean(r['place'] for r in rows):.2f}.",
                  f"Average purchases: {statistics.mean(r['tiles'] for r in rows):.1f}; spending: {statistics.mean(r['spent'] for r in rows):.1f}; cash left: {statistics.mean(r['cash'] for r in rows):.1f}."]
    if any("profile" in r for r in rows):
        lines += ["", "| Profile | Games | Wins | Top three | Avg score | Avg place | Purchases |",
                  "|---|---:|---:|---:|---:|---:|---:|"]
        for name in sorted({r["profile"] for r in rows}):
            group = [r for r in rows if r["profile"] == name]
            n = len(group)
            lines.append(f"| {name} | {n} | {sum(r['place'] == 1 for r in group)}/{n} | {sum(r['place'] <= 3 for r in group)}/{n} | {statistics.mean(r['score'] for r in group):.1f} | {statistics.mean(r['place'] for r in group):.2f} | {statistics.mean(r['tiles'] for r in group):.1f} |")
    windows = [w for r in rows for w in r.get("refill_windows", [])]
    if windows:
        lines += ["", f"Midgame rebuilding: {statistics.mean(w['purchases'] for w in windows):.2f} purchases in the ten offers following a 20+ point word ({len(windows)} full windows with cash at least 25).",
                  "This is a diagnostic; it includes only payouts with ten remaining offers and at most 37, and does not infer rack size."]
    lines += ["", "The collector only observes games; it does not start, stop, or configure the bot."]
    out.write_text("\n".join(lines) + "\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--since", type=int, required=True)
    ap.add_argument("--matches", type=int, default=8)
    ap.add_argument("--out", type=pathlib.Path, required=True)
    ap.add_argument("--archive", type=pathlib.Path, required=True)
    ap.add_argument("--description", required=True)
    ap.add_argument("--assignments", type=pathlib.Path, help="JSONL profile assignments; collect only assigned matches")
    ap.add_argument("--poll", type=float, default=8)
    ap.add_argument("--timeout", type=float, default=1200)
    a = ap.parse_args()
    if a.matches < 1 or a.poll <= 0 or a.timeout <= 0:
        ap.error("matches, poll, and timeout must be positive")
    state = {"since": a.since, "target": a.matches, "description": a.description,
             "started_utc": datetime.now(timezone.utc).isoformat(), "results": []}
    if a.archive.exists():
        state = json.loads(a.archive.read_text())
        if (state["since"], state["target"], state["description"]) != (a.since, a.matches, a.description):
            ap.error("archive belongs to a different trial; use a new archive path")
    seen = {r["match"] for r in state["results"]}
    render(state, a.out)
    deadline = time.monotonic() + a.timeout
    while len(seen) < a.matches and time.monotonic() < deadline:
        ended = {int(r[0]) for r in sql(f"SELECT id, status FROM match_state WHERE id > {a.since}") if "ended" in r[1].lower()}
        ours = {int(r[0]) for r in sql(f"SELECT match_id FROM match_participant WHERE bot_id = {US} AND match_id > {a.since}")}
        assigned = None
        if a.assignments:
            assigned = {}
            if a.assignments.exists():
                for line in a.assignments.read_text().splitlines(keepends=True):
                    if not line.endswith("\n"):
                        continue  # wait for the writer to finish the last record
                    entry = json.loads(line)
                    mid = int(entry["match"])
                    if mid in assigned and assigned[mid] != entry:
                        raise ValueError(f"profile changed within match {mid}")
                    assigned[mid] = entry
        eligible = ended & ours
        if assigned is not None:
            eligible &= assigned.keys()
        for mid in sorted(eligible - seen):
            result = capture(mid)
            if assigned is not None:
                result["profile"] = assigned[mid]["profile"]
                result["profile_params"] = assigned[mid]["params"]
                result["trial_game"] = assigned[mid]["trial_game"]
            state["results"].append(result)
            seen.add(mid)
            a.archive.write_text(json.dumps(state, indent=2) + "\n")
            render(state, a.out)
            print(f"{len(seen)}/{a.matches}: match {mid}, profile {result.get('profile', 'fixed')}, place {result['place']}/{result['players']}, score {result['score']}, tiles {result['tiles']}, cash {result['cash']}", flush=True)
            if len(seen) >= a.matches:
                break
        if len(seen) < a.matches:
            time.sleep(a.poll)
    print(f"Checkpoint: {len(seen)}/{a.matches} completed. Bot remains independent.", flush=True)
    if len(seen) < a.matches:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
