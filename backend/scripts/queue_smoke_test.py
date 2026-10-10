#!/usr/bin/env python3
"""Walk the whole ticket queue through a RUNNING API and check the results (stdlib only).

    python scripts/queue_smoke_test.py --reset          # restarts the queue session first
    python scripts/queue_smoke_test.py --reset --limit 10

--reset is required when tickets were already issued, because this test consumes
the queue (and clears any evaluation results in the current session).

Checks: provider labelling matches /health; /next never repeats a ticket and never
exposes expected_severity; every analysis returns P1-P4 with a duration; the
end-of-queue state; and that /evaluation's accuracy and confusion matrix agree
with the per-ticket results. Prints the evaluation summary.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request

LABELS = ("P1", "P2", "P3", "P4")


def call(method: str, url: str) -> tuple[int, dict]:
    req = urllib.request.Request(url, method=method, headers={"Content-Type": "application/json"},
                                 data=b"" if method == "POST" else None)
    try:
        with urllib.request.urlopen(req, timeout=300) as res:
            return res.status, json.loads(res.read())
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read() or b"{}")


def check(condition: bool, message: str) -> None:
    if not condition:
        print(f"FAIL  {message}")
        sys.exit(1)
    print(f"ok    {message}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--reset", action="store_true", help="reset the queue session first")
    parser.add_argument("--limit", type=int, default=0, help="analyze at most N tickets (0 = all)")
    parser.add_argument("--wait", type=float, default=180, help="seconds to wait for model readiness")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")
    api = f"{base}/api/v1/tickets"

    try:
        inference = call("GET", f"{base}/health")[1]["inference"]
    except urllib.error.URLError as exc:
        print(f"FAIL  backend not reachable at {base}: {exc.reason}")
        sys.exit(1)
    deadline = time.monotonic() + args.wait
    while not inference["ready"] and inference["state"] in ("loading", "not_loaded") and time.monotonic() < deadline:
        time.sleep(2)
        inference = call("GET", f"{base}/health")[1]["inference"]
    print(f"info  provider={inference['provider']} model_id={inference['model_id']} "
          f"state={inference['state']} device={inference.get('device')}")
    check(inference["ready"], "inference provider is ready")

    status, session = call("GET", f"{api}/session")
    check(status == 200, "GET /tickets/session returns 200")
    if session["issued"] and not args.reset:
        print("Tickets were already issued in this session; re-run with --reset.")
        sys.exit(2)
    if args.reset:
        status, session = call("POST", f"{api}/reset")
        check(status == 200 and session["issued"] == 0, "POST /tickets/reset starts a new session")
    total = session["total"]

    seen: set[str] = set()
    analyzed = 0
    durations: list[float] = []
    for _ in range(total):
        status, nxt = call("GET", f"{api}/next")
        if status != 200:
            check(False, f"GET /tickets/next returns 200 (got {status}: {nxt})")
        ticket = nxt["ticket"]
        if ticket is None or "expected_severity" in json.dumps(nxt) or ticket["ticket_id"] in seen:
            check(False, f"/next issued a fresh ticket without its label: {nxt}")
        seen.add(ticket["ticket_id"])
        if args.limit and analyzed >= args.limit:
            continue
        status, res = call("POST", f"{api}/{ticket['ticket_id']}/analyze")
        if status == 502:
            print(f"warn  {ticket['ticket_id']}: invalid model output (recorded)")
        elif status != 200:
            check(False, f"analyze {ticket['ticket_id']} returns 200 (got {status}: {res})")
        else:
            if res["severity"] not in LABELS or res["provider"] != inference["provider"] \
                    or res["is_mock"] != inference["is_mock"] or res["inference_ms"] < 0:
                check(False, f"analysis response is consistent: {res}")
            durations.append(res["inference_ms"])
        analyzed += 1
    check(len(seen) == total, f"/next issued all {total} tickets exactly once")
    check(analyzed > 0, f"analyzed {analyzed} tickets via the {inference['provider']} provider")

    status, end = call("GET", f"{api}/next")
    check(status == 200 and end["exhausted"] and end["ticket"] is None, f"end of queue: {end.get('message')}")

    status, ev = call("GET", f"{api}/evaluation")
    check(status == 200 and ev["analyzed"] == analyzed, "evaluation covers every analyzed ticket")
    rows = ev["results"]
    correct = sum(r["correct"] is True for r in rows)
    check(ev["correct"] == correct and ev["accuracy"] == round(correct / len(rows), 4),
          "accuracy matches per-ticket results")
    matrix_total = sum(sum(row.values()) for row in ev["confusion_matrix"].values())
    check(matrix_total == len(rows), "confusion matrix sums to the analyzed count")
    check(all(r["is_mock"] == inference["is_mock"] for r in rows), "every result carries the active provider label")

    print()
    kind = "SYNTHETIC mock agreement (not a model evaluation)" if ev["is_mock"] else "accuracy"
    print(f"{ev['provider']} / {ev['model_id']}")
    print(f"{kind}: {ev['correct']}/{ev['analyzed']} = {ev['accuracy']:.1%}   invalid outputs: {ev['invalid_outputs']}")
    if durations:
        print(f"inference ms: mean {sum(durations) / len(durations):.0f}, min {min(durations):.0f}, max {max(durations):.0f}")
    print("confusion matrix (rows = expected, cols = predicted):")
    print("        " + " ".join(f"{c:>7}" for c in (*LABELS, "invalid")))
    for exp in LABELS:
        print(f"  {exp}    " + " ".join(f"{ev['confusion_matrix'][exp][c]:>7}" for c in (*LABELS, "invalid")))
    print("\nQUEUE SMOKE TEST PASSED")


if __name__ == "__main__":
    main()
