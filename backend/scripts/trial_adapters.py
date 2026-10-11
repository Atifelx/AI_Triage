"""Trial run: what does each trained adapter actually return?

Loads the base model once, attaches every available LoRA adapter, sends each one
its exact training prompt for a few incidents, and prints the raw generated text
plus what it parses to. Use this before wiring a model capability into the app.

    cd backend && python scripts/trial_adapters.py            # auto device (MPS on a Mac)
    python scripts/trial_adapters.py --device cpu --incident-lora ~/Downloads/incident_triage_dataset/incident-lora

Cases: one held-out row from training/data/incident_test_v3.jsonl (in-distribution,
with its reference answer) and the two hand-written form samples used by the UI.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.services.errors import InvalidModelOutputError  # noqa: E402
from app.services.providers.base import IncidentInput  # noqa: E402
from app.services.providers.gemma_prompt import (  # noqa: E402
    build_chat_messages,
    build_text_chat_messages,
    render_incident_text,
)
from app.services.providers.gemma_triage_prompt import (  # noqa: E402
    INCIDENT_LORA_PROFILE,
    REQUIRED_TRIAGE_KEYS,
    V3_PROFILE,
)
from app.services.severity_parser import parse_severity_output  # noqa: E402
from app.services.triage_parser import parse_triage_output  # noqa: E402

MODELS = BACKEND / "models"
TEST_FILE = BACKEND.parent / "training/data/incident_test_v3.jsonl"

FORM_CASES = {
    "form: M365 sign-in (sample 1)": IncidentInput(
        title="Microsoft 365 sign-in failures",
        description="Multiple employees cannot sign in.",
        affected_service="Microsoft 365",
        affected_users=45,
        affected_departments=("Finance", "Operations"),
        affected_sites=("Mumbai", "Pune"),
        business_impact="Employees cannot access business applications.",
        workaround_available=False,
        diagnostic_evidence="Authentication failures reported by affected users.",
    ),
    "form: print queue (sample 2)": IncidentInput(
        title="Finance print queue stuck",
        description="Invoices sent to the shared finance printer never print.",
        affected_service="Print services",
        affected_users=12,
        affected_departments=("Finance",),
        affected_sites=("Mumbai",),
        business_impact="Finance team cannot print invoices for month-end close; other departments are unaffected.",
        workaround_available=True,
        diagnostic_evidence="Print queue shows jobs stuck in spooling state.",
    ),
}


def classify(raw: str, adapter: str) -> str:
    """Describe the output: full five-field analysis, severity only, or invalid."""
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = None
    keys = sorted(data) if isinstance(data, dict) else None
    shape = (
        "FULL five-field analysis"
        if keys and set(REQUIRED_TRIAGE_KEYS) <= set(keys)
        else "SEVERITY ONLY"
        if keys == ["severity"]
        else f"other JSON keys {keys}"
        if keys
        else "not JSON"
    )
    try:
        if adapter == "severity":
            parse_severity_output(raw)
        else:
            parse_triage_output(raw, V3_PROFILE if adapter == "triage-v3" else INCIDENT_LORA_PROFILE)
        verdict = "passes API validation"
    except InvalidModelOutputError as exc:
        verdict = f"REJECTED by API validation: {exc.internal_detail}"
    return f"{shape} · {verdict}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--device", default="auto", choices=["auto", "cpu", "mps", "cuda"])
    ap.add_argument(
        "--incident-lora",
        default=str(Path("~/Downloads/incident_triage_dataset/incident-lora").expanduser()),
        help="Path to the older incident-lora adapter (skipped if missing)",
    )
    args = ap.parse_args()

    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer

    device = args.device
    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "mps" if torch.backends.mps.is_available() else "cpu"

    adapters = {
        "severity": MODELS / "gemma3-270m-severity/adapter",
        "triage-v3": MODELS / "gemma3-270m-triage-v3/adapter",
    }
    if Path(args.incident_lora).is_dir():
        adapters["incident-lora"] = Path(args.incident_lora)

    print(f"device={device} · adapters: {', '.join(adapters)}\n")
    tok = AutoTokenizer.from_pretrained(str(adapters["severity"]))
    base = AutoModelForCausalLM.from_pretrained(
        str(MODELS / "gemma3-270m-severity/base"), dtype=torch.float32, local_files_only=True
    ).to(device)
    names = list(adapters)
    model = PeftModel.from_pretrained(base, str(adapters[names[0]]), adapter_name=names[0])
    for name in names[1:]:
        model.load_adapter(str(adapters[name]), adapter_name=name)
    model.eval()

    def generate(adapter: str, messages: list[dict[str, str]], max_new_tokens: int) -> tuple[str, float]:
        prompt = tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
        enc = tok(prompt, return_tensors="pt", add_special_tokens=False).to(device)
        model.set_adapter(adapter)
        t = time.perf_counter()
        with torch.inference_mode():
            out = model.generate(**enc, max_new_tokens=max_new_tokens, do_sample=False, pad_token_id=tok.eos_token_id)
        return tok.decode(out[0][enc["input_ids"].shape[1] :], skip_special_tokens=True).strip(), time.perf_counter() - t

    cases: list[tuple[str, str, IncidentInput | None, str | None]] = []
    if TEST_FILE.is_file():
        row = json.loads(TEST_FILE.read_text(encoding="utf-8").splitlines()[0])
        cases.append((f"held-out test row {row['id']}", row["input"], None, row["output"]))
    for label, incident in FORM_CASES.items():
        cases.append((label, render_incident_text(incident), incident, None))

    summary = []
    for label, text, incident, reference in cases:
        print("=" * 100)
        print(f"CASE: {label}")
        if reference:
            print(f"REFERENCE: {reference}")
        for name in names:
            if name == "severity":
                messages = build_chat_messages(incident) if incident else build_text_chat_messages(text)
                raw, secs = generate(name, messages, 32)
            else:
                profile = V3_PROFILE if name == "triage-v3" else INCIDENT_LORA_PROFILE
                raw, secs = generate(name, profile.build_chat_messages(text), 256)
            verdict = classify(raw, name)
            summary.append((label, name, verdict))
            print(f"\n[{name}] {secs:.2f}s → {verdict}\n{raw}")
        print()

    print("=" * 100)
    print("SUMMARY")
    for label, name, verdict in summary:
        print(f"  {label:<38} {name:<14} {verdict}")


if __name__ == "__main__":
    main()
