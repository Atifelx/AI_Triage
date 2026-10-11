# Gemma 3 270M IT — IT Incident Triage, five fields (LoRA)

The full incident-triage adapter. The backend attaches it to the same base model as the
severity adapter (`../gemma3-270m-severity/base`) when `TRIAGE_ADAPTER_PATH` points here, and
serves it through `POST /api/v1/triage/full`.

| | |
|---|---|
| Task | One JSON object: `category`, `severity`, `root_cause`, `evidence[]`, `recommended_actions[]`, `human_review_required` |
| Prompt | `TRIAGE_PROMPT_FORMAT=v3`: training instruction + `"\n\nIncident:\n"` + incident narrative (see `app/services/providers/gemma_triage_prompt.py`) |
| Base model | `google/gemma-3-270m-it` |
| Training | `training/scripts/train_lora_resumable.py`: 800 rows of `training/data/incident_train_v3.jsonl`, 3 epochs, LoRA r=8 α=16 on q/k/v/o, lr 1e-4 |
| Source | `~/AI-Lab/incident_triage_dataset_v3/outputs/gemma3-270m-lora-resumable` (copied without optimizer state; checksums in `SHA256SUMS`) |
| License | Gemma Terms of Use; see `NOTICE` |

## Offline evaluation (`evaluation_metrics.json`)

Measured by `training/scripts/evaluate_lora_v3.py` on the 100-row held-out synthetic test split
(`training/data/incident_test_v3.jsonl`), greedy decoding:

| Metric | Base model | This adapter |
|---|---:|---:|
| Valid JSON | 99% | 100% |
| Category exact match | 1% | 100% |
| Root-cause exact match | 0% | 100% |
| **Severity exact match** | 7% | **43%** |

Severity is weak: the dedicated severity adapter (`../gemma3-270m-severity`) reached 100% on
the same kind of data. The API therefore runs that adapter as a cross-check
(`SEVERITY_CROSS_CHECK=true`) and flags disagreement.

Not measured: evidence quality and recommended-action quality/safety (no labelled evaluation
exists). The data is synthetic and template-based; hand-written incidents are out of
distribution. In local checks the adapter sometimes returns a category outside the taxonomy
(for example `"print"`); such output is rejected as `invalid_model_output`.
