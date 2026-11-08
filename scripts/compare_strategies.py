#!/usr/bin/env python3
"""Run independent offline strategy comparisons concurrently.

    python3 scripts/compare_strategies.py --both-markets
    python3 scripts/compare_strategies.py --variants trialBaseline,cash39 --matches 80 --seed 19

Every job uses the same seeds and rotates seats inside the simulator. Market
scaling is a synthetic stress test. This script never starts or changes a live
bot. Full stdout, stderr, commands, and parsed results are retained for review.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import math
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
BOT_DIR = ROOT / "bot-starter"
DEFAULT_VARIANTS = "liveBaseline,cash39,crunch24,reserveCap"
METRICS = {
    "avg_score": "avgScore",
    "avg_rank": "avgRank",
    "top2_pct": "top2%",
    "top3_pct": "top3%",
    "tiles": "tiles",
}


def positive_int(value: str) -> int:
    number = int(value)
    if number <= 0:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return number


def positive_float(value: str) -> float:
    number = float(value)
    if not math.isfinite(number) or number <= 0:
        raise argparse.ArgumentTypeError("must be finite and positive")
    return number


def parse_metrics(stdout: str, variant: str) -> dict[str, float]:
    """Locate the named result row using its table header, not line numbers."""
    columns: dict[str, int] | None = None
    for line in stdout.splitlines():
        cells = line.split()
        if not cells:
            continue
        if cells[0] == "name" and all(label in cells for label in METRICS.values()):
            columns = {label: cells.index(label) for label in METRICS.values()}
            continue
        if columns is None or cells[0] != variant:
            continue
        try:
            metrics = {key: float(cells[columns[label]]) for key, label in METRICS.items()}
        except (ValueError, IndexError) as error:
            raise ValueError(f"malformed result row for {variant}: {line}") from error
        if not all(math.isfinite(value) for value in metrics.values()):
            raise ValueError(f"non-finite result for {variant}: {line}")
        return metrics
    raise ValueError(f"no simulator table row found for {variant}")


def run_job(variant: str, scale: float, args: argparse.Namespace, output: Path, number: int) -> dict:
    prefix = output / f"{number:02d}-{variant}-glue{scale:g}"
    stdout_path = prefix.with_name(prefix.name + ".stdout.txt")
    stderr_path = prefix.with_name(prefix.name + ".stderr.txt")
    command = [
        "node", "--import", "tsx", "src/sim/run.ts", "--leaders", "--live-market",
        "--variant", variant, "--matches", str(args.matches), "--seed", str(args.seed),
        "--glue-scale", str(scale),
    ]
    result = {
        "variant": variant, "glue_scale": scale, "matches": args.matches,
        "seed": args.seed, "command": command, "cwd": str(BOT_DIR),
        "stdout_path": str(stdout_path), "stderr_path": str(stderr_path),
    }
    started = time.monotonic()
    try:
        completed = subprocess.run(command, cwd=BOT_DIR, capture_output=True, text=True)
        stdout_path.write_text(completed.stdout)
        stderr_path.write_text(completed.stderr)
        result["returncode"] = completed.returncode
        if completed.returncode:
            detail = "\n".join((completed.stderr or completed.stdout).splitlines()[-12:])
            result["error"] = f"simulator exited {completed.returncode}" + (f"\n{detail}" if detail else "")
        else:
            result["metrics"] = parse_metrics(completed.stdout, variant)
    except (OSError, ValueError) as error:
        result["error"] = str(error)
    result["elapsed_seconds"] = round(time.monotonic() - started, 3)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--variants", default=DEFAULT_VARIANTS, help="comma-separated simulator profile names")
    parser.add_argument("--matches", type=positive_int, default=40)
    parser.add_argument("--seed", type=positive_int, default=17)
    parser.add_argument("--workers", type=positive_int, default=4)
    parser.add_argument("--glue-scale", type=positive_float, default=1.0)
    parser.add_argument("--both-markets", action="store_true", help="run each profile at glue scales 1 and 1.2")
    parser.add_argument("--out-dir", type=Path, help="directory for full job logs and summary.json")
    args = parser.parse_args()
    variants = list(dict.fromkeys(name.strip() for name in args.variants.split(",")))
    if not variants or any(not re.fullmatch(r"[A-Za-z0-9_-]+", name) for name in variants):
        parser.error("--variants must contain nonempty profile names using letters, numbers, underscores or hyphens")
    if args.both_markets and args.glue_scale != 1.0:
        parser.error("use --both-markets by itself, or choose one --glue-scale")
    scales = [1.0, 1.2] if args.both_markets else [args.glue_scale]
    output = args.out_dir.expanduser().resolve() if args.out_dir else Path(tempfile.mkdtemp(prefix="scrabble-compare-", dir="/private/tmp"))
    output.mkdir(parents=True, exist_ok=True)
    jobs = [(name, scale) for scale in scales for name in variants]
    results = []
    print(f"Offline comparisons: {args.matches} matches per job, seed {args.seed}, up to {args.workers} workers.")
    print(f"Full logs: {output}", flush=True)
    print("\n| Strategy | Glue scale | Avg score | Avg rank | Top two % | Top three % | Purchases |")
    print("|---|---:|---:|---:|---:|---:|---:|", flush=True)
    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        pending = {
            executor.submit(run_job, name, scale, args, output, number): (name, scale)
            for number, (name, scale) in enumerate(jobs, 1)
        }
        for future in as_completed(pending):
            result = future.result()
            results.append(result)
            if "error" in result:
                print(f"FAILED {result['variant']} (glue {result['glue_scale']:g}): {result['error']}\nLogs: {result['stdout_path']}, {result['stderr_path']}", file=sys.stderr, flush=True)
            else:
                metric = result["metrics"]
                print(f"| {result['variant']} | {result['glue_scale']:g} | {metric['avg_score']:.1f} | {metric['avg_rank']:.2f} | {metric['top2_pct']:.1f} | {metric['top3_pct']:.1f} | {metric['tiles']:.1f} |", flush=True)
            # Preserve completed work even if a later job fails or the run is interrupted.
            (output / "summary.json").write_text(json.dumps(sorted(results, key=lambda row: (row["glue_scale"], row["variant"])), indent=2) + "\n")
    failures = sum("error" in result for result in results)
    print(f"\nCompleted {len(results)} jobs; {failures} failed. Summary: {output / 'summary.json'}", flush=True)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
