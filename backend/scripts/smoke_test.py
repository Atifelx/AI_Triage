#!/usr/bin/env python3
"""Smoke test against a RUNNING API (stdlib only, no test dependencies).

    python scripts/smoke_test.py                     # http://localhost:8000
    python scripts/smoke_test.py --base-url http://10.0.0.5:8000
    python scripts/smoke_test.py --wait 120          # wait for a model to finish loading

Checks: /health shape, readiness, POST /api/v1/triage with a sample incident,
response contract, mock labelling consistency, GET by request_id, and a 422
validation error. Exits non-zero on the first failure.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request

SAMPLE = {
    "title": "Microsoft 365 sign-in failures",
    "description": "Multiple employees cannot sign in.",
    "affected_service": "Microsoft 365",
    "affected_users": 45,
    "affected_departments": ["Finance", "Operations"],
    "affected_sites": ["Mumbai", "Pune"],
    "business_impact": "Employees cannot access business applications.",
    "workaround_available": False,
    "diagnostic_evidence": "Authentication failures reported by affected users.",
}
RESPONSE_KEYS = {
    "request_id", "incident_title", "severity", "human_review_required", "provider",
    "model_id", "is_mock", "inference_ms", "created_at",
}


def call(method: str, url: str, body: dict | None = None) -> tuple[int, dict]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
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
    parser.add_argument("--wait", type=float, default=0, help="seconds to wait for provider readiness")
    args = parser.parse_args()
    base = args.base_url.rstrip("/")

    try:
        status, health = call("GET", f"{base}/health")
    except urllib.error.URLError as exc:
        print(f"FAIL  backend not reachable at {base}: {exc.reason}")
        sys.exit(1)
    check(status == 200 and health.get("status") == "ok", "GET /health returns status ok")
    inference = health["inference"]
    check({"provider", "model_id", "ready", "model_loaded", "state", "is_mock"} <= set(inference),
          "health reports provider, model_id, ready, model_loaded, state")

    deadline = time.monotonic() + args.wait
    while not inference["ready"] and inference["state"] in ("loading", "not_loaded") \
            and time.monotonic() < deadline:
        time.sleep(2)
        inference = call("GET", f"{base}/health")[1]["inference"]
    print(f"info  provider={inference['provider']} model_id={inference['model_id']} "
          f"state={inference['state']} device={inference.get('device')}")
    check(inference["ready"], "inference provider is ready")
    if inference["is_mock"]:
        check(inference["model_loaded"] is False, "mock provider does not claim a loaded model")

    status, result = call("POST", f"{base}/api/v1/triage", SAMPLE)
    check(status == 200, f"POST /api/v1/triage returns 200 (got {status}: {result})")
    check(set(result) == RESPONSE_KEYS, "response matches the public contract exactly")
    check(result["severity"] in {"P1", "P2", "P3", "P4"}, f"severity is valid ({result['severity']})")
    check(result["provider"] == inference["provider"], "response provider matches /health")
    check(result["is_mock"] == inference["is_mock"], "mock labelling matches /health")
    check(result["human_review_required"] is True, "human review is required")
    check(result["incident_title"] == SAMPLE["title"], "incident title echoed")
    print(f"info  severity={result['severity']} provider={result['provider']} "
          f"inference_ms={result['inference_ms']} mock={result['is_mock']}")

    status, fetched = call("GET", f"{base}/api/v1/triage/{result['request_id']}")
    check(status == 200 and fetched == result, "GET /api/v1/triage/{request_id} returns the same result")

    status, error = call("POST", f"{base}/api/v1/triage", {**SAMPLE, "affected_users": -5})
    check(status == 422 and error["error"]["code"] == "validation_error", "invalid input returns 422")

    print("\nSMOKE TEST PASSED")


if __name__ == "__main__":
    main()
