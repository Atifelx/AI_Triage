import json, re
from pathlib import Path
import torch
from peft import PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

ROOT = Path(__file__).resolve().parent.parent
MODEL_ID = "google/gemma-3-270m-it"
ADAPTER = ROOT / "outputs/gemma3-270m-lora-resumable"
TEST = ROOT / "data/incident_test_v3.jsonl"

rows = [json.loads(x) for x in TEST.read_text().splitlines() if x.strip()]
device = torch.device("mps" if torch.backends.mps.is_available() else "cpu")
tok = AutoTokenizer.from_pretrained(MODEL_ID)

def load_model(adapter=False):
    m = AutoModelForCausalLM.from_pretrained(MODEL_ID, dtype=torch.float32)
    if adapter:
        m = PeftModel.from_pretrained(m, ADAPTER)
    return m.to(device).eval()

def parse_json(s):
    try:
        v = json.loads(s.strip())
        return v if isinstance(v, dict) else None
    except Exception:
        m = re.search(r"\{.*\}", s, re.S)
        if m:
            try:
                v = json.loads(m.group())
                return v if isinstance(v, dict) else None
            except Exception:
                pass
    return None

def predict(model, row):
    prompt = row["instruction"] + "\n\nIncident:\n" + row["input"]
    rendered = tok.apply_chat_template(
        [{"role":"user","content":prompt}],
        tokenize=False, add_generation_prompt=True
    )
    inputs = tok(rendered, return_tensors="pt", add_special_tokens=False).to(device)
    with torch.no_grad():
        ids = model.generate(
            **inputs, max_new_tokens=180, do_sample=False,
            pad_token_id=tok.eos_token_id
        )
    answer = ids[0, inputs["input_ids"].shape[1]:]
    return parse_json(tok.decode(answer, skip_special_tokens=True))

results = {}
for name, use_adapter in [("base", False), ("lora", True)]:
    print(f"\nLoading {name} model...", flush=True)
    model = load_model(use_adapter)
    counts = {k: 0 for k in ("category","severity","root_cause","valid_json")}
    details = []
    for i, row in enumerate(rows, 1):
        pred = predict(model, row)
        counts["valid_json"] += pred is not None
        for field in ("category","severity","root_cause"):
            counts[field] += pred is not None and pred.get(field) == row[field]
        details.append({
            "id": row.get("id"),
            "expected": {k: row[k] for k in ("category","severity","root_cause")},
            "prediction": pred
        })
        if i % 10 == 0 or i == len(rows):
            print(f"{name}: {i}/{len(rows)}", flush=True)
    results[name] = {
        k: {"correct": int(v), "total": len(rows),
            "accuracy_percent": round(100 * v / len(rows), 2)}
        for k, v in counts.items()
    }
    (ROOT / "outputs").mkdir(exist_ok=True)
    (ROOT / "outputs" / f"predictions_{name}_v3.json").write_text(
        json.dumps(details, indent=2, ensure_ascii=False)
    )
    del model
    if device.type == "mps":
        torch.mps.empty_cache()

print("\n=== BASE vs LORA ===")
print(json.dumps(results, indent=2))
(ROOT / "outputs/evaluation_metrics_v3.json").write_text(json.dumps(results, indent=2))
