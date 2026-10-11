"""Build the ticket queue (120) and manual-triage examples (50) from HELD-OUT data.

Sources: training/data/incident_test_v3.jsonl and incident_val_v3.jsonl. Neither adapter
was trained on these rows (verified: no input overlaps the 800 training rows or the
severity adapter's 320 training rows). Training rows are deliberately not used: the
model has memorised them, so demos on them would overstate accuracy.

  queue    : all 100 test rows + 5 val rows per severity  -> data/tickets.jsonl
  examples : 50 further val rows (balanced, unique text)   -> data/examples.jsonl

    cd backend && python scripts/build_demo_data.py
"""

from __future__ import annotations

import json
import random
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND / "scripts"))
from incident_examples import form_fields  # noqa: E402

DATA = BACKEND.parent / "training/data"
SEVERITIES = ("P1", "P2", "P3", "P4")


def load(name: str) -> list[dict]:
    return [json.loads(line) for line in (DATA / name).read_text(encoding="utf-8").splitlines() if line.strip()]


def by_severity(rows: list[dict]) -> dict[str, list[dict]]:
    return {s: [r for r in rows if r["severity"] == s] for s in SEVERITIES}


def main() -> None:
    rng = random.Random(7)
    test, val = load("incident_test_v3.jsonl"), load("incident_val_v3.jsonl")
    training_inputs = {r["input"] for r in load("incident_train_v3.jsonl")}
    assert not training_inputs & {r["input"] for r in test + val}, "held-out rows overlap training data"

    val_groups = by_severity(val)
    queue_rows = test + [r for s in SEVERITIES for r in val_groups[s][:5]]
    rng.shuffle(queue_rows)

    used_narratives = {form_fields(r)["description"] for r in queue_rows}
    examples: list[dict] = []
    for s in SEVERITIES:
        picked = 0
        for r in val_groups[s][5:]:
            fields = form_fields(r)
            if fields["description"] in used_narratives:
                continue
            used_narratives.add(fields["description"])
            examples.append({**fields, "reference": {"severity": r["severity"], "category": r["category"], "root_cause": r["root_cause"]}})
            picked += 1
            if picked == (13 if s in ("P1", "P2") else 12):
                break
    rng.shuffle(examples)

    with (BACKEND / "data/tickets.jsonl").open("w", encoding="utf-8") as fh:
        for r in queue_rows:
            fh.write(json.dumps({
                "ticket_id": r["id"],
                "title": form_fields(r)["title"],
                "description": r["input"],  # the original ticket text, unchanged
                "expected_severity": r["severity"],
                "expected_category": r["category"],
                "expected_root_cause": r["root_cause"],
                # Structured fields for the human-review ticket only; never sent to the model.
                "incident": {k: v for k, v in form_fields(r).items() if k != "source_id"},
            }, ensure_ascii=False) + "\n")
    with (BACKEND / "data/examples.jsonl").open("w", encoding="utf-8") as fh:
        for e in examples:
            fh.write(json.dumps(e, ensure_ascii=False) + "\n")

    print(f"queue: {len(queue_rows)} tickets ({len({r['input'] for r in queue_rows})} unique)")
    print(f"examples: {len(examples)} ({len({e['description'] for e in examples})} unique narratives)")
    print("example severities:", {s: sum(e['reference']['severity'] == s for e in examples) for s in SEVERITIES})


if __name__ == "__main__":
    main()
