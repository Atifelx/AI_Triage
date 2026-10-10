import json
import random
from pathlib import Path
from collections import Counter

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data/incident_train_v3.jsonl"
TRAIN = ROOT / "data/severity_train_v1.jsonl"
VAL = ROOT / "data/severity_val_v1.jsonl"

rng = random.Random(42)
groups = {s: [] for s in ("P1", "P2", "P3", "P4")}

for line in SOURCE.read_text().splitlines():
    if not line.strip():
        continue
    row = json.loads(line)
    target = json.loads(row["output"])
    severity = target["severity"]
    groups[severity].append(row)

selected = []
for severity, rows in groups.items():
    if len(rows) < 100:
        raise ValueError(f"{severity} has only {len(rows)} examples")
    rng.shuffle(rows)
    selected.extend(rows[:100])

rng.shuffle(selected)

instruction = (
    "Classify ONLY the incident severity using the documented business impact "
    "and confirmed scope. Apply these rules: P1 = critical service unavailable "
    "across multiple departments and at least two sites, with no safe workaround; "
    "P2 = multiple users affected within one department while other departments "
    "remain operational; P3 = one user or endpoint affected while others work "
    "normally; P4 = no material service interruption and low business impact. "
    "Prioritize confirmed business impact and scope over technical symptoms. "
    'Return only valid JSON in the form {"severity":"P1"}, using exactly one '
    "of P1, P2, P3, or P4."
)

converted = []
for row in selected:
    severity = json.loads(row["output"])["severity"]
    converted.append({
        "id": row["id"],
        "category": row["category"],
        "severity": severity,
        "root_cause": row["root_cause"],
        "instruction": instruction,
        "input": row["input"],
        "output": json.dumps({"severity": severity}, separators=(",", ":")),
    })

# Stratified split: 80 training + 20 validation per severity.
train_rows, val_rows = [], []
for severity in ("P1", "P2", "P3", "P4"):
    rows = [r for r in converted if r["severity"] == severity]
    rng.shuffle(rows)
    train_rows.extend(rows[:80])
    val_rows.extend(rows[80:])

rng.shuffle(train_rows)
rng.shuffle(val_rows)

for path, rows in ((TRAIN, train_rows), (VAL, val_rows)):
    path.write_text("".join(json.dumps(r) + "\n" for r in rows))

print("Dataset created")
print("Training:", len(train_rows), Counter(r["severity"] for r in train_rows))
print("Validation:", len(val_rows), Counter(r["severity"] for r in val_rows))
print("Files:", TRAIN, VAL)
