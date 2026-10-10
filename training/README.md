# Training material

This is a copy of `~/AI-Lab/incident_triage_dataset_v3` (scripts, data, docs and
evaluation outputs) taken on 2026-10-10, kept here so the project is
self-contained and the model can be reproduced. Dataset details are in
`DATASET_README.md`.

```
scripts/build_severity_dataset.py   incident_train_v3 -> severity_train_v1 / severity_val_v1 (80/20 per class)
scripts/train_severity_lora.py      trains the LoRA adapter shipped in backend/models/gemma3-270m-severity/adapter
scripts/evaluate_severity_lora.py   evaluates the adapter on data/incident_test_v3.jsonl
scripts/generate_dataset.py, validate_dataset.py   synthetic v3 dataset generator and validator
scripts/*_v3.py, train_lora_resumable.py           earlier multi-field experiments (not used by the app)
data/                               synthetic datasets (train / val / test splits + severity subsets)
outputs/*.json                      evaluation reports from the original runs
```

The app's ticket queue (`backend/data/tickets.jsonl`) consists of the first 50 rows
of `data/incident_test_v3.jsonl`. Do not use the test split for training or model selection.

## Retraining

From this folder, using an environment with torch, transformers and peft:

```bash
python scripts/build_severity_dataset.py   # optional: rebuilds the severity splits
python scripts/train_severity_lora.py
```

The scripts load the base model by Hugging Face id (`google/gemma-3-270m-it`). To
train offline, change `MODEL_ID` in the script to `../backend/models/gemma3-270m-severity/base`.
The new adapter is written to `outputs/gemma3-270m-severity-lora/best_adapter`. Copy it
over `backend/models/gemma3-270m-severity/adapter/` and regenerate `SHA256SUMS` there.
