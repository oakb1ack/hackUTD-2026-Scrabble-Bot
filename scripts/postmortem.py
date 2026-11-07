#!/usr/bin/env python3
"""Post-mortem for one match: why we placed where we did.

    python3 scripts/postmortem.py 42900 [--log path/to/bot.log]

Prints a compact comparison of us vs the winner: tiles, spend, words,
premium letters, tempo (auction # of each word), lost premium auctions
with our bid vs the clearing price (needs the bot log), and a one-line
diagnosis.
"""
import argparse
import os
import re
import subprocess

US = "182"
LV = dict(zip("ABCDEFGHIJKLMNOPQRSTUVWXYZ",
              [1, 3, 3, 2, 1, 4, 2, 4, 1, 8, 5, 1, 3, 1, 1, 3, 10, 1, 1, 1, 1, 4, 4, 8, 4, 10]))
SPACETIME = os.path.expanduser("~/.local/bin/spacetime")


def sql(q):
    out = subprocess.run([SPACETIME, "sql", "scrabblebot", q], capture_output=True, text=True).stdout
    rows = []
    for line in out.splitlines():
        if "UNSTABLE" in line or line.startswith("---") or not line.strip():
            continue
        rows.append([c.strip().strip('"') for c in line.split("|")])
    return rows[1:]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("match", type=int)
    ap.add_argument("--log", default=None)
    a = ap.parse_args()
    m = a.match

    parts = sorted(((int(s), b) for b, s in sql(f"SELECT bot_id, score FROM match_participant WHERE match_id = {m}")), reverse=True)
    if not parts:
        print(f"match {m}: no data yet")
        return
    names = {r[0]: r[1] for r in sql("SELECT id, name FROM bot") if len(r) > 1}
    order = [b for _, b in parts]
    if US not in order:
        print(f"match {m}: we were not in it")
        return
    place = order.index(US) + 1
    winner = order[0]
    score = dict((b, s) for s, b in parts)

    ar = sql(f"SELECT auction_id, letter, winner_bot_id, paid FROM auction_result WHERE match_id = {m}")
    ar.sort(key=lambda r: int(r[0]))
    buys = {}
    for i, (aid, letter, w, paid) in enumerate(ar, 1):
        mm = re.search(r"\d+", w)
        if mm:
            buys.setdefault(mm.group(), []).append((i, letter, int(paid)))
    wp = sql(f"SELECT bot_id, word, total_reward, played_at FROM word_play WHERE match_id = {m}")
    words = {}
    for b, word, rew, t in wp:
        words.setdefault(b, []).append((t, word, int(rew)))
    for b in words:
        words[b].sort()

    def summary(b):
        bl = buys.get(b, [])
        ws = words.get(b, [])
        spent = sum(p for _, _, p in bl)
        face = sum(LV[l] for _, l, _ in bl) / max(1, len(bl))
        prem = "".join(l for _, l, _ in bl if LV[l] >= 4)
        wtxt = " ".join(f"{w}({r})" for _, w, r in ws)
        return f"{names.get(b, b):<16} score {score[b]:>3}  tiles {len(bl):>2}  spent {spent:>3}  face {face:.2f}  premium [{prem}]  words: {wtxt}"

    print(f"match {m}: {place}/{len(order)}  winner {names.get(winner, winner)} {score[winner]}  us {score[US]}")
    print("  " + summary(US) + "  <- us")
    if winner != US:
        print("  " + summary(winner) + "  <- winner")
    else:
        print("  " + summary(order[1]) + "  <- runner-up")

    # Lost premium auctions, our bid vs clearing price (from the bot log)
    if a.log and os.path.exists(a.log):
        bids = {}
        for line in open(a.log, errors="replace"):
            mm = re.search(rf"bid (\d+) on '(.)' \(match {m}, auction (\d+)\)", line)
            if mm:
                bids[mm.group(3)] = int(mm.group(1))
        lost = []
        for aid, letter, w, paid in ar:
            if LV[letter] >= 4 and US not in w:
                lost.append(f"{letter}@{paid}(us {bids.get(aid, '-')})")
        if lost:
            print("  lost premium auctions (letter@paid(our bid)): " + " ".join(lost))
        total_bids = len(bids)
        print(f"  our bids: {total_bids}/{len(ar)} auctions")

    # Diagnosis
    us_b = buys.get(US, []); w_b = buys.get(winner, [])
    us_w = words.get(US, []); w_w = words.get(winner, [])
    notes = []
    if winner != US:
        if len(w_b) - len(us_b) >= 4:
            notes.append(f"winner bought {len(w_b) - len(us_b)} more tiles")
        us_face = sum(LV[l] for _, l, _ in us_b) / max(1, len(us_b))
        w_face = sum(LV[l] for _, l, _ in w_b) / max(1, len(w_b))
        if w_face - us_face >= 0.4:
            notes.append(f"winner's tiles worth more (face {w_face:.2f} vs {us_face:.2f})")
        us_big = max([r for _, _, r in us_w] or [0]); w_big = max([r for _, _, r in w_w] or [0])
        if w_big - us_big >= 15:
            notes.append(f"winner's best word {w_big} vs ours {us_big}")
        if len(w_w) - len([1 for _, _, r in us_w if r >= 20]) >= 2:
            notes.append("winner cycled more big words")
    short = [w for _, w, r in us_w if len(w) <= 3]
    if len(short) >= 2:
        notes.append(f"we dumped {len(short)} short words: {' '.join(short)}")
    bal = sql(f"SELECT balance FROM match_participant WHERE match_id = {m} AND bot_id = {US}")
    if bal and bal[0] and bal[0][0].isdigit() and int(bal[0][0]) >= 25:
        notes.append(f"we left {bal[0][0]} unspent")
    print("  why: " + ("; ".join(notes) if notes else "no single obvious cause"))


if __name__ == "__main__":
    main()
