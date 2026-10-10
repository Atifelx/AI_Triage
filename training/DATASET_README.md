# Enterprise IT Incident Triage Dataset v3

## Use
Starter dataset for Gemma 3 270M IT LoRA experiments. This is controlled synthetic data, not a production-certified benchmark.

## Files
- `data/incident_train_v3.jsonl`: 800 examples
- `data/incident_val_v3.jsonl`: 100 examples
- `data/incident_test_v3.jsonl`: 100 examples
- `data/dataset_report_v3.json`: validator report
- `docs/taxonomy.json`: 10 categories, 20 root causes, severity policy
- `docs/cause_details.json`: curated cause-specific evidence and safe actions
- `scripts/generate_dataset.py`: repeatable generator
- `scripts/validate_dataset.py`: structural and consistency checks

## v3 corrections
- Severity narrative is explicitly aligned to scope: P1 multiple departments/sites; P2 multiple users in one department; P3 one user/endpoint; P4 no material interruption.
- Every target contains both diagnostic evidence and scope evidence.
- Targets use fixed labels and valid JSON.
- Human review remains required; the model must not autonomously execute remediation.
- Exact input duplicates and split coverage are checked.

## Limitations
The examples are synthetic and use controlled scenario composition. Automated checks cannot establish factual correctness or guarantee 90%+ accuracy on real tickets. Before production use, supplement them with privacy-scrubbed, IT-SME-reviewed incidents and evaluate on a separate real-world test set.

## Commands
Run validation from this folder:
```bash
python scripts/validate_dataset.py
```
Regenerate the dataset:
```bash
python scripts/generate_dataset.py
python scripts/validate_dataset.py
```
The train script should consume each row's `instruction`, `input`, and `output` fields. Do not use the test split for training or model selection.
