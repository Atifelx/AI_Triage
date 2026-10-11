"""Trial: does the way the manual form is rendered into a prompt change model accuracy?

Runs held-out validation rows (never trained on) through both adapters with several
renderings of the same incident and scores category / severity / root cause against the
row's reference labels:

  V0  exact training text (upper bound)
  V1  current form rendering (title + service + computed scope sentence)
  V2  form rendering with the scope check and additional context passed through verbatim
  V3  training layout rebuilt from the form fields (no title / service sentence)

    cd backend && python scripts/trial_form_rendering.py --rows 60
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from collections import defaultdict
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND / "scripts"))

from incident_examples import form_fields  # noqa: E402

from app.services.errors import InvalidModelOutputError  # noqa: E402
from app.services.providers.base import IncidentInput  # noqa: E402
from app.services.providers.gemma_prompt import SEVERITY_INSTRUCTION, render_incident_text  # noqa: E402
from app.services.providers.gemma_triage_prompt import V3_PROFILE  # noqa: E402
from app.services.severity_parser import parse_severity_output  # noqa: E402
from app.services.triage_parser import parse_triage_output  # noqa: E402

MODELS = BACKEND / "models"
VAL = BACKEND.parent / "training/data/incident_val_v3.jsonl"


def _s(t: str) -> str:
    t = " ".join(t.split())
    return t if t.endswith((".", "!", "?")) else t + "."


def incident(f: dict) -> IncidentInput:
    return IncidentInput(
        title=f["title"], description=f["description"], affected_service=f["affected_service"],
        affected_users=f["affected_users"], business_impact=f["business_impact"],
        affected_departments=tuple(f["affected_departments"]), affected_sites=tuple(f["affected_sites"]),
        workaround_available=f["workaround_available"], diagnostic_evidence=f["diagnostic_evidence"],
    )


def renderings(row: dict) -> dict[str, str]:
    f = form_fields(row)
    v1 = render_incident_text(incident(f))
    head = f"{_s(f['title'])} {_s(f['description'])} {_s('Affected service: ' + f['affected_service'])}"
    tail = (
        f"Business impact: {_s(f['business_impact'])} Diagnostic evidence: {_s(f['diagnostic_evidence'])} "
        f"Scope check: {_s(f['scope_check'])} Additional context: {_s(f['additional_context'])}"
    )
    return {"V0": row["input"], "V1": v1, "V2": f"{head} {tail}", "V3": f"{_s(f['description'])} {tail}"}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rows", type=int, default=60)
    ap.add_argument("--device", default="auto")
    args = ap.parse_args()

    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer

    device = args.device
    if device == "auto":
        device = "mps" if torch.backends.mps.is_available() else "cpu"
    tok = AutoTokenizer.from_pretrained(str(MODELS / "gemma3-270m-severity/adapter"))
    base = AutoModelForCausalLM.from_pretrained(str(MODELS / "gemma3-270m-severity/base"), dtype=torch.float32, local_files_only=True).to(device)
    model = PeftModel.from_pretrained(base, str(MODELS / "gemma3-270m-severity/adapter"), adapter_name="severity")
    model.load_adapter(str(MODELS / "gemma3-270m-triage-v3/adapter"), adapter_name="triage")
    model.eval()

    def gen(adapter: str, content: str, n: int) -> str:
        prompt = tok.apply_chat_template([{"role": "user", "content": content}], tokenize=False, add_generation_prompt=True)
        enc = tok(prompt, return_tensors="pt", add_special_tokens=False).to(device)
        model.set_adapter(adapter)
        with torch.inference_mode():
            out = model.generate(**enc, max_new_tokens=n, do_sample=False, pad_token_id=tok.eos_token_id)
        return tok.decode(out[0][enc["input_ids"].shape[1]:], skip_special_tokens=True).strip()

    rows = [json.loads(line) for line in VAL.read_text().splitlines() if line.strip()]
    # Balanced subset: first N/4 of each severity.
    per = max(1, args.rows // 4)
    picked = [r for sev in ("P1", "P2", "P3", "P4") for r in [x for x in rows if x["severity"] == sev][:per]]

    score: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    started = time.perf_counter()
    for i, row in enumerate(picked, 1):
        for name, text in renderings(row).items():
            s = score[name]
            s["n"] += 1
            try:
                a = parse_triage_output(gen("triage", V3_PROFILE.build_user_message(text), 192), V3_PROFILE)
                s["valid"] += 1
                s["category"] += a.category == row["category"]
                s["severity_triage"] += a.severity == row["severity"]
                s["root_cause"] += a.root_cause == row["root_cause"]
            except InvalidModelOutputError:
                pass
            try:
                s["severity_adapter"] += parse_severity_output(gen("severity", SEVERITY_INSTRUCTION + "\n\n" + text, 32)) == row["severity"]
            except InvalidModelOutputError:
                pass
        print(f"  {i}/{len(picked)} rows · {time.perf_counter() - started:.0f}s", flush=True)

    print(f"\nHeld-out validation rows: {len(picked)} (balanced P1–P4)\n")
    cols = ["valid", "category", "root_cause", "severity_triage", "severity_adapter"]
    print(f"{'variant':<8}" + "".join(f"{c:>18}" for c in cols))
    for name in ("V0", "V1", "V2", "V3"):
        s = score[name]
        print(f"{name:<8}" + "".join(f"{100 * s[c] / s['n']:>17.0f}%" for c in cols))
    example = renderings(picked[0])
    print("\nExample renderings of", picked[0]["id"])
    for k, v in example.items():
        print(f"  {k}: {v[:260]}...")


if __name__ == "__main__":
    main()
