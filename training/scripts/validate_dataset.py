#!/usr/bin/env python3
import json, re, sys
from pathlib import Path
from collections import Counter
ROOT=Path(__file__).resolve().parents[1]; DATA=ROOT/"data"
EXPECTED={"incident_train_v3.jsonl":800,"incident_val_v3.jsonl":100,"incident_test_v3.jsonl":100}
TAX=json.loads((ROOT/"docs/taxonomy.json").read_text(encoding="utf-8"))
cats=set(TAX["categories"]); causes={x["root_cause"] for x in TAX["root_causes"]}; sevs={"P1","P2","P3","P4"}
errors=[]; report={}; all_inputs=[]; all_ids=set()
for fn,n in EXPECTED.items():
 p=DATA/fn
 if not p.exists(): errors.append(f"Missing {fn}"); continue
 rows=[]
 for ln,line in enumerate(p.read_text(encoding="utf-8").splitlines(),1):
  try: r=json.loads(line); o=json.loads(r["output"])
  except Exception as e: errors.append(f"{fn}:{ln}: invalid JSON: {e}"); continue
  rows.append(r)
  for k in ["id","instruction","input","output","category","severity","root_cause"]:
   if k not in r: errors.append(f"{fn}:{ln}: missing {k}")
  if r.get("id") in all_ids: errors.append(f"duplicate id {r.get('id')}")
  all_ids.add(r.get("id")); all_inputs.append(r.get("input"))
  if r.get("category") not in cats: errors.append(f"{fn}:{ln}: invalid category")
  if r.get("severity") not in sevs: errors.append(f"{fn}:{ln}: invalid severity")
  if r.get("root_cause") not in causes: errors.append(f"{fn}:{ln}: invalid root cause")
  if any(o.get(k)!=r.get(k) for k in ["category","severity","root_cause"]): errors.append(f"{fn}:{ln}: label mismatch")
  if set(o)!={"category","severity","root_cause","evidence","recommended_actions","human_review_required"}: errors.append(f"{fn}:{ln}: output keys mismatch")
  if not isinstance(o.get("evidence"),list) or len(o["evidence"])<2: errors.append(f"{fn}:{ln}: evidence needs diagnostic and scope")
  if not isinstance(o.get("recommended_actions"),list) or not o["recommended_actions"]: errors.append(f"{fn}:{ln}: missing actions")
  if o.get("human_review_required") is not True: errors.append(f"{fn}:{ln}: human review must be true")
  impact={"P1":"across multiple departments and at least two sites","P2":"multiple users in one department","P3":"one user or one endpoint","P4":"no material service interruption"}
  if impact.get(r["severity"]) not in r["input"]: errors.append(f"{fn}:{ln}: severity/scope narrative mismatch")
  if not re.search(r"\ba [aeiou]",r["input"],re.I) is None: errors.append(f"{fn}:{ln}: grammar article check failed")
 if len(rows)!=n: errors.append(f"{fn}: expected {n}, got {len(rows)}")
 report[fn]={"rows":len(rows),"categories":dict(Counter(x.get("category") for x in rows)),
   "severity":dict(Counter(x.get("severity") for x in rows)),"root_causes":len(set(x.get("root_cause") for x in rows)),
   "duplicate_inputs":len(rows)-len(set(x.get("input") for x in rows))}
if len(all_inputs)!=len(set(all_inputs)): errors.append("duplicate incident input across splits")
for fn in EXPECTED:
 p=DATA/fn
 if p.exists():
  rows=[json.loads(x) for x in p.read_text(encoding="utf-8").splitlines()]
  if {r["root_cause"] for r in rows}!=causes: errors.append(f"{fn}: missing root cause classes")
out={"status":"PASS" if not errors else "FAIL","summaries":report,"errors":errors,
 "note":"Structural and consistency checks only; synthetic examples require IT-SME review and evaluation on held-out real incidents before production claims."}
(DATA/"dataset_report_v3.json").write_text(json.dumps(out,indent=2),encoding="utf-8")
print(json.dumps(out,indent=2)); sys.exit(1 if errors else 0)
