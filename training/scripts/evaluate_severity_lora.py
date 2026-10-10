import json
import re
import time
from pathlib import Path
from collections import Counter

import torch
from transformers import AutoTokenizer, AutoModelForCausalLM
from peft import PeftModel

ROOT = Path(__file__).resolve().parents[1]
MODEL_ID = "google/gemma-3-270m-it"
ADAPTER = ROOT / "outputs/gemma3-270m-severity-lora/best_adapter"
TEST_FILE = ROOT / "data/incident_test_v3.jsonl"
TRAIN_FILE = ROOT / "data/severity_train_v1.jsonl"
OUT_FILE = ROOT / "outputs/severity_test_predictions.json"

SEVERITIES = ["P1", "P2", "P3", "P4"]


def read_jsonl(path):
    with open(path) as f:
        return [json.loads(line) for line in f if line.strip()]


def main():
    train = read_jsonl(TRAIN_FILE)
    test = read_jsonl(TEST_FILE)

    instruction = train[0]["instruction"]
    device = "mps" if torch.backends.mps.is_available() else "cpu"

    print(f"Device: {device}")
    print(f"Test examples: {len(test)}")
    print("Loading tokenizer and model...")

    tokenizer = AutoTokenizer.from_pretrained(ADAPTER)
    base = AutoModelForCausalLM.from_pretrained(
        MODEL_ID, torch_dtype=torch.float32
    ).to(device)
    model = PeftModel.from_pretrained(base, str(ADAPTER))
    model.eval()

    results = []
    valid_predictions = 0
    correct = 0
    confusion = Counter()
    class_counts = Counter()
    class_correct = Counter()
    start_all = time.time()

    for i, row in enumerate(test, 1):
        expected = row["severity"]
        user_content = instruction + "\n\nIncident:\n" + row["input"]
        messages = [{"role": "user", "content": user_content}]

        prompt = tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
        inputs = tokenizer(prompt, return_tensors="pt").to(device)

        start = time.time()
        with torch.inference_mode():
            output = model.generate(
                **inputs,
                max_new_tokens=32,
                do_sample=False,
                pad_token_id=tokenizer.eos_token_id,
            )
        elapsed = time.time() - start

        generated = output[0][inputs["input_ids"].shape[1]:]
        raw = tokenizer.decode(generated, skip_special_tokens=True).strip()

        predicted = None
        try:
            parsed = json.loads(raw)
            candidate = parsed.get("severity")
            if candidate in SEVERITIES:
                predicted = candidate
        except (json.JSONDecodeError, AttributeError):
            match = re.search(r'"severity"\s*:\s*"(P[1-4])"', raw)
            if match:
                predicted = match.group(1)

        if predicted:
            valid_predictions += 1
            confusion[(expected, predicted)] += 1
            class_counts[expected] += 1
            if predicted == expected:
                correct += 1
                class_correct[expected] += 1

        results.append({
            "id": row.get("id"),
            "expected": expected,
            "predicted": predicted,
            "correct": predicted == expected if predicted else False,
            "raw_output": raw,
            "inference_seconds": round(elapsed, 3),
        })

        if i % 10 == 0 or i == len(test):
            print(f"Evaluated {i}/{len(test)}")

    total = len(test)
    accuracy = correct / total if total else 0
    per_class = {}

    for label in SEVERITIES:
        tp = confusion[(label, label)]
        actual = sum(confusion[(label, p)] for p in SEVERITIES)
        predicted_count = sum(confusion[(actual_label, label)]
                              for actual_label in SEVERITIES)
        precision = tp / predicted_count if predicted_count else 0
        recall = tp / actual if actual else 0
        f1 = (
            2 * precision * recall / (precision + recall)
            if precision + recall else 0
        )
        per_class[label] = {
            "precision": round(precision, 4),
            "recall": round(recall, 4),
            "f1": round(f1, 4),
            "support": sum(row["severity"] == label for row in test),
        }

    macro_f1 = sum(v["f1"] for v in per_class.values()) / len(SEVERITIES)
    matrix = {
        actual: {
            pred: confusion[(actual, pred)] for pred in SEVERITIES
        }
        for actual in SEVERITIES
    }

    report = {
        "model": MODEL_ID,
        "adapter": str(ADAPTER),
        "test_examples": total,
        "correct": correct,
        "accuracy": round(accuracy, 4),
        "valid_severity_predictions": valid_predictions,
        "invalid_predictions": total - valid_predictions,
        "macro_f1": round(macro_f1, 4),
        "per_class": per_class,
        "confusion_matrix_actual_rows_predicted_columns": matrix,
        "total_evaluation_seconds": round(time.time() - start_all, 2),
        "predictions": results,
    }

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUT_FILE.write_text(json.dumps(report, indent=2))

    print("\n=== TEST RESULTS ===")
    print(f"Accuracy: {correct}/{total} = {accuracy:.1%}")
    print(f"Valid severity outputs: {valid_predictions}/{total}")
    print(f"Macro F1: {macro_f1:.3f}")
    print("\nPer-class metrics:")
    for label, metrics in per_class.items():
        print(
            f"{label}: precision={metrics['precision']:.3f}, "
            f"recall={metrics['recall']:.3f}, "
            f"F1={metrics['f1']:.3f}, support={metrics['support']}"
        )

    print("\nConfusion matrix (rows=actual, columns=predicted):")
    print("       " + " ".join(f"{s:>5}" for s in SEVERITIES))
    for actual in SEVERITIES:
        print(actual + "    " + " ".join(
            f"{matrix[actual][pred]:>5}" for pred in SEVERITIES
        ))

    print(f"\nDetailed report saved to: {OUT_FILE}")


if __name__ == "__main__":
    main()
