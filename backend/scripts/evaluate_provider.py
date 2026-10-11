#!/usr/bin/env python3
"""Evaluate an inference provider on a labelled JSONL split, through the app's own provider code.

    python scripts/evaluate_provider.py --provider gemma --out ../eval/gemma_test.json
    python scripts/evaluate_provider.py --provider vllm  --out ../eval/vllm_test.json \\
        --compare ../eval/gemma_test.json

The provider gets each incident's text only (`input` or `description`); the label
(`output` JSON or `expected_severity`) is read afterwards for scoring. Settings come
from backend/.env, overridden by the flags. --compare reports row-by-row agreement
with an earlier run (e.g. vLLM vs direct Transformers).
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from collections import Counter
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app.core.config import Settings  # noqa: E402
from app.services.errors import InferenceError  # noqa: E402
from app.services.providers.factory import build_provider  # noqa: E402

LABELS = ("P1", "P2", "P3", "P4")


def load_rows(path: Path) -> list[tuple[str, str, str]]:
    """(id, text, expected) from either the dataset format or the ticket-queue format."""
    rows = []
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        r = json.loads(line)
        if "expected_severity" in r:
            rows.append((r["ticket_id"], r["description"], r["expected_severity"]))
        else:
            rows.append((r["id"], r["input"], json.loads(r["output"])["severity"]))
    return rows


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider", choices=["gemma", "vllm", "mock"], required=True)
    parser.add_argument("--data", type=Path, default=BACKEND_DIR.parent / "training/data/incident_test_v3.jsonl")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--out", type=Path, help="write per-row predictions JSON here")
    parser.add_argument("--compare", type=Path, help="earlier --out file to compare against row by row")
    parser.add_argument("--structured-output", action="store_true", help="vllm only: constrain to the label schema")
    parser.add_argument("--wait", type=float, default=180, help="seconds to wait for the provider to be ready")
    args = parser.parse_args()

    overrides = {"inference_provider": args.provider}
    if args.structured_output:
        overrides["vllm_structured_output"] = True
    settings = Settings(_env_file=BACKEND_DIR / ".env", **overrides)  # type: ignore[call-arg]
    provider = build_provider(settings)
    provider.start()
    deadline = time.monotonic() + args.wait
    while not provider.status().ready and time.monotonic() < deadline:
        if provider.status().state.value == "unavailable" and args.provider != "vllm":
            break
        time.sleep(1)
    status = provider.status()
    print(f"provider={provider.name} model_id={provider.model_id} state={status.state.value} device={status.device}")
    if not status.ready:
        print(f"NOT READY: {status.detail}")
        return 1

    rows = load_rows(args.data)[: args.limit or None]
    records, conf, latencies = [], Counter(), []
    correct = invalid = failed = 0
    for rid, text, expected in rows:
        try:
            pred = provider.predict_severity_from_text(text)
        except InferenceError as exc:
            outcome = "invalid_output" if exc.code == "invalid_model_output" else exc.code
            invalid += outcome == "invalid_output"
            failed += outcome != "invalid_output"
            records.append({"id": rid, "expected": expected, "predicted": None, "outcome": outcome})
            continue
        latencies.append(pred.inference_ms)
        conf[(expected, pred.severity)] += 1
        correct += pred.severity == expected
        records.append({"id": rid, "expected": expected, "predicted": pred.severity,
                        "outcome": "predicted", "inference_ms": pred.inference_ms})
    provider.shutdown()

    n = len(rows)
    print(f"\n{args.data.name}: {correct}/{n} correct ({correct / n:.1%}), invalid outputs {invalid}, errors {failed}")
    if latencies:
        print(f"latency ms: mean {statistics.mean(latencies):.0f}, median {statistics.median(latencies):.0f}, "
              f"min {min(latencies):.0f}, max {max(latencies):.0f}")
    print("confusion (rows = expected, cols = predicted):  " + "  ".join(f"{c:>3}" for c in LABELS))
    for e in LABELS:
        print(f"  {e}  " + "  ".join(f"{conf[(e, p)]:>3}" for p in LABELS))

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps({
            "provider": provider.name, "model_id": provider.model_id, "data": args.data.name,
            "structured_output": bool(args.structured_output), "n": n, "correct": correct,
            "invalid_outputs": invalid, "errors": failed, "records": records,
        }, indent=2))
        print(f"\nwrote {args.out}")

    if args.compare:
        other = {r["id"]: r for r in json.loads(args.compare.read_text())["records"]}
        same = sum(1 for r in records if r["id"] in other and other[r["id"]]["predicted"] == r["predicted"])
        diffs = [r for r in records if r["id"] in other and other[r["id"]]["predicted"] != r["predicted"]]
        print(f"\nrow-by-row agreement with {args.compare.name}: {same}/{len(records)}")
        for r in diffs[:10]:
            print(f"  {r['id']}: here {r['predicted']} vs there {other[r['id']]['predicted']} (expected {r['expected']})")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
