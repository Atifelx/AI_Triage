#!/usr/bin/env python3
"""Load the REAL GemmaSeverityProvider and check it end to end (no FastAPI needed).

Runs with only torch/transformers/peft installed, e.g. from ~/AI-Lab/.venv:

    cd backend
    ~/AI-Lab/.venv/bin/python scripts/verify_gemma_provider.py \
        --base-model-path models/gemma3-270m-severity/base \
        --adapter-path models/gemma3-270m-severity/adapter --val-limit 20

1. Loads base model + LoRA adapter through the provider's own startup path.
2. Runs one structured incident through predict_severity() (the API code path).
3. Optional parity check: feeds VALIDATION-split rows (never the test split)
   through the provider's generation path using the exact training prompt
   (instruction + "\\n\\n" + input) and reports how many outputs are valid and
   match the label. This confirms the provider reproduces the training format;
   it is not a model evaluation.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services.errors import InferenceError  # noqa: E402
from app.services.providers.base import IncidentInput  # noqa: E402
from app.services.providers.gemma_provider import GemmaSeverityProvider  # noqa: E402
from app.services.severity_parser import parse_severity_output  # noqa: E402

SAMPLE = IncidentInput(
    title="Microsoft 365 sign-in failures",
    description="Multiple employees cannot sign in.",
    affected_service="Microsoft 365",
    affected_users=45,
    affected_departments=("Finance", "Operations"),
    affected_sites=("Mumbai", "Pune"),
    business_impact="Employees cannot access business applications.",
    workaround_available=False,
    diagnostic_evidence="Authentication failures reported by affected users.",
)


def resolve(path: str, base: str) -> Path:
    p = Path(path).expanduser()
    if not p.is_absolute() and base:
        p = Path(base).expanduser() / p
    return p.resolve()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-id", default=os.getenv("MODEL_ID", "google/gemma-3-270m-it"))
    parser.add_argument("--base-model-path", default=os.getenv("BASE_MODEL_PATH", ""),
                        help="local base model dir (relative to backend/); empty = MODEL_ID from HF")
    parser.add_argument("--adapter-path", default=os.getenv(
        "ADAPTER_PATH", "outputs/gemma3-270m-severity-lora/best_adapter"))
    parser.add_argument("--adapter-base-dir", default=os.getenv("ADAPTER_BASE_DIR", ""))
    parser.add_argument("--device", default=os.getenv("DEVICE", "auto"))
    parser.add_argument("--max-new-tokens", type=int, default=int(os.getenv("MAX_NEW_TOKENS", "32")))
    parser.add_argument("--val-file", default="../training/data/severity_val_v1.jsonl",
                        help="relative to backend/; must be a validation split")
    parser.add_argument("--val-limit", type=int, default=0, help="0 = skip parity check")
    args = parser.parse_args()

    if "test" in Path(args.val_file).name:
        print("Refusing to use a test split for this check.")
        return 2

    backend_dir = str(Path(__file__).resolve().parents[1])
    provider = GemmaSeverityProvider(
        base_model_id=args.model_id,
        base_model_path=resolve(args.base_model_path, backend_dir) if args.base_model_path else None,
        adapter_path=resolve(args.adapter_path, args.adapter_base_dir or backend_dir),
        device=args.device,
        max_new_tokens=args.max_new_tokens,
    )
    started = time.perf_counter()
    provider.start()
    provider.wait_until_settled()
    status = provider.status()
    print(f"load: state={status.state.value} device={status.device} "
          f"model_loaded={status.model_loaded} seconds={time.perf_counter() - started:.1f}")
    if not status.ready:
        print(f"Provider not ready: {status.detail}")
        return 1
    print(f"model_id: {provider.model_id}")

    try:
        prediction = provider.predict_severity(SAMPLE)
    except InferenceError as exc:
        print(f"sample incident: ERROR {exc.code}: {exc.public_message} ({exc.internal_detail})")
        return 1
    print(f"sample incident: severity={prediction.severity} inference_ms={prediction.inference_ms}")

    if args.val_limit > 0:
        val_path = resolve(args.val_file, backend_dir)
        rows = [json.loads(line) for line in val_path.read_text().splitlines() if line.strip()]
        rows = rows[: args.val_limit]
        valid = correct = 0
        for row in rows:
            messages = [{"role": "user", "content": row["instruction"] + "\n\n" + row["input"]}]
            raw = provider._generate(messages)  # same tokenisation/generation as the API path
            try:
                predicted = parse_severity_output(raw)
            except InferenceError:
                print(f"  invalid output for {row['id']}: {raw[:80]!r}")
                continue
            valid += 1
            correct += predicted == row["severity"]
        print(f"validation parity ({val_path.name}, n={len(rows)}): "
              f"valid_json={valid}/{len(rows)} matches_label={correct}/{len(rows)}")

    provider.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
