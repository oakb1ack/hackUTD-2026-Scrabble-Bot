#!/usr/bin/env python3
"""Competitor tracker: who we're up against and how they're doing.

Pulls the last N matches from the live ScrabbleBot database via the
`spacetime` CLI (must be installed and logged in) and writes a markdown
table to COMPETITORS.md plus stdout.

    python3 scripts/competitors.py            # last 60 matches
    python3 scripts/competitors.py --matches 120
    python3 scripts/competitors.py --since 42750

Columns: games, avg/best score, tiles bought per game, spend per game,
avg face value of bought tiles, share of 4-point-plus tiles, words per
game, avg word length, and head-to-head vs us (how often they finish
above scrabblemaxxing when we share a match).
"""
import argparse
import collections
import os
import re
import statistics
import subprocess
import sys
from datetime import datetime, timezone

US = 182
LETTER_VALUE = dict(zip("ABCDEFGHIJKLMNOPQRSTUVWXYZ",
                        [1, 3, 3, 2, 1, 4, 2, 4, 1, 8, 5, 1, 3, 1, 1, 3, 10, 1, 1, 1, 1, 4, 4, 8, 4, 10]))
SPACETIME = os.path.expanduser("~/.local/bin/spacetime")


def sql(query):
    out = subprocess.run([SPACETIME, "sql", "scrabblebot", query],
                         capture_output=True, text=True, check=True).stdout
    rows = []
    for line in out.splitlines():
        if "UNSTABLE" in line or line.startswith("---") or not line.strip():
            continue
        cells = [c.strip().strip('"') for c in line.split("|")]
        rows.append(cells)
    return rows[1:] if rows else []  # drop header


def latest_match_id():
    # Enum columns can't be filtered in SQL, so take the max id over a
    # recent range (ids grow ~3 per match; 2000 covers a few days).
    probe = 42000
    while True:
        rows = sql(f"SELECT id FROM match_state WHERE id > {probe}")
        ids = [int(r[0]) for r in rows if r and r[0].isdigit()]
        if ids and len(ids) < 5000:
            return max(ids)
        probe += 2000 if ids else -2000
        if probe < 0:
            return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--matches", type=int, default=60)
    ap.add_argument("--since", type=int, default=None)
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "COMPETITORS.md"))
    a = ap.parse_args()

    hi = latest_match_id() + 1
    lo = a.since if a.since else hi - a.matches * 3  # match ids skip by ~3
    rng = f"match_id > {lo} AND match_id < {hi}"

    states = sql(f"SELECT id, status FROM match_state WHERE id > {lo} AND id < {hi}")
    ended = {r[0] for r in states if len(r) > 1 and "ended" in r[1].lower()}
    parts = [r for r in sql(f"SELECT match_id, bot_id, score, balance FROM match_participant WHERE {rng}") if r[0] in ended]
    buys = [r[1:] for r in sql(f"SELECT match_id, winner_bot_id, letter, paid FROM auction_result WHERE {rng}") if r[0] in ended]
    words = [r[1:] for r in sql(f"SELECT match_id, bot_id, word, total_reward FROM word_play WHERE {rng}") if r[0] in ended]
    names = {r[0]: r[1] for r in sql("SELECT id, name FROM bot") if len(r) > 1}

    by_match = collections.defaultdict(list)
    balances = collections.defaultdict(list)
    for mid, bot, score, balance in parts:
        by_match[int(mid)].append((int(score), bot))
        balances[bot].append(int(balance))
    games = collections.Counter()
    scores = collections.defaultdict(list)
    wins = collections.Counter()
    top3 = collections.Counter()
    place_total = collections.Counter()
    beat_us = collections.Counter()
    shared = collections.Counter()
    for mid, ps in by_match.items():
        ps.sort(reverse=True)
        ours = next((s for s, b in ps if int(b) == US), None)
        high = max(s for s, _ in ps)
        tied_winners = sum(s == high for s, _ in ps)
        for s, b in ps:
            games[b] += 1
            scores[b].append(s)
            if s == high:
                wins[b] += 1 / tied_winners
            place = 1 + sum(other_score > s for other_score, _ in ps)
            place_total[b] += place
            top3[b] += place <= 3
            if ours is not None and int(b) != US:
                shared[b] += 1
                if s > ours:
                    beat_us[b] += 1

    tiles = collections.Counter(); spent = collections.Counter()
    face = collections.Counter(); hv = collections.Counter()
    for w, letter, paid in buys:
        m = re.search(r"\d+", w)
        if not m:
            continue
        b = m.group()
        tiles[b] += 1
        spent[b] += int(paid)
        v = LETTER_VALUE.get(letter, 0)
        face[b] += v
        if v >= 4:
            hv[b] += 1

    wcount = collections.Counter(); wlen = collections.Counter(); long_words = collections.Counter(); best_word = {}
    for b, word, reward in words:
        wcount[b] += 1
        wlen[b] += len(word)
        long_words[b] += len(word) >= 7
        r = int(reward)
        if r > best_word.get(b, ("", 0))[1]:
            best_word[b] = (word, r)

    rows = []
    for b, g in games.items():
        if g < 3:
            continue
        t = tiles[b] or 1
        sc = scores[b]
        rows.append({
            "bot": b, "name": names.get(b, "?"), "games": g,
            "avg": statistics.mean(sc), "best": max(sc),
            "sd": statistics.pstdev(sc) if len(sc) > 1 else 0,
            "win_pct": 100 * wins[b] / g, "top3_pct": 100 * top3[b] / g,
            "place": place_total[b] / g,
            "tiles": tiles[b] / g, "spent": spent[b] / g,
            "balance": statistics.mean(balances[b]),
            "long": 100 * long_words[b] / max(1, wcount[b]),
            "face": face[b] / t, "hv": 100 * hv[b] / t,
            "words": wcount[b] / g, "wlen": wlen[b] / max(1, wcount[b]),
            "bw": best_word.get(b, ("-", 0)),
            "h2h": (beat_us[b], shared[b]),
        })
    rows.sort(key=lambda r: (-r["win_pct"], -r["games"], -r["avg"]))

    n_matches = len(by_match)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [f"# Competitors — {n_matches} completed matches (ids {lo+1}-{hi-1}), {stamp}", "",
             "| # | bot | name | games | win% | top3% | avg | place | best | sd | tiles/g | spent/g | face | hv% | words/g | len | 7+% | cash left | best word | beat us |",
             "|--:|--:|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|"]
    for i, r in enumerate(rows, 1):
        us = " **(us)**" if int(r["bot"]) == US else ""
        h2h = f"{r['h2h'][0]}/{r['h2h'][1]}" if r["h2h"][1] else "-"
        lines.append(
            f"| {i} | {r['bot']} | {r['name']}{us} | {r['games']} | {r['win_pct']:.0f} | {r['top3_pct']:.0f} | {r['avg']:.1f} | {r['place']:.2f} | {r['best']} | {r['sd']:.0f} "
            f"| {r['tiles']:.1f} | {r['spent']:.0f} | {r['face']:.2f} | {r['hv']:.0f} | {r['words']:.1f} "
            f"| {r['wlen']:.1f} | {r['long']:.0f} | {r['balance']:.0f} | {r['bw'][0]} ({r['bw'][1]}) | {h2h} |")
    lines += ["",
              "Only ended matches are counted; the server may retain fewer matches than the requested window. Rows are sorted by shared win rate; small samples are noisy.",
              "win% = shared credit across bots tied at the top; top3% counts tied places using 1 + the number of strictly higher scores.",
              "face = avg Scrabble value of bought tiles; hv% = share of bought tiles worth 4+;",
              "7+% = share of plays with at least seven letters; cash left = average final balance.",
              "beat us = matches they finished above scrabblemaxxing / matches shared.",
              "Regenerate: `python3 scripts/competitors.py`"]
    text = "\n".join(lines) + "\n"
    with open(a.out, "w") as f:
        f.write(text)
    print(text)


if __name__ == "__main__":
    main()
