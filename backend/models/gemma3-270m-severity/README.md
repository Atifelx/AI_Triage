# Gemma 3 270M IT — IT Incident Severity Classifier (LoRA)

This folder holds the project's fine-tuned severity model. The FastAPI backend loads it
through `app/services/providers/gemma_provider.py`; the folder itself contains no code.

| | |
|---|---|
| Task | Classify an IT incident narrative as **P1 / P2 / P3 / P4** |
| Output | Exactly `{"severity":"P1"}` (strict JSON, one of P1–P4) |
| Base model | `google/gemma-3-270m-it`, Hugging Face revision in `base/HF_REVISION` |
| Fine-tuning | LoRA adapter (PEFT), trained by `training/scripts/train_severity_lora.py` |
| License | Base model and derivative: **Gemma Terms of Use**; see `NOTICE` |

```
gemma3-270m-severity/
  README.md        this model card
  NOTICE           Gemma Terms of Use notice (required when redistributing)
  SHA256SUMS       checksums of the installed model files
  adapter/         the fine-tuned LoRA adapter + tokenizer/chat template (35 MB, in git)
  base/            config.json, generation_config.json: Google's originals (in git)
                   model.safetensors: base weights, 511 MB, NOT in git; see below
```

### Installing the base weights

```bash
cd backend && python scripts/download_model.py
```

The script downloads only `base/model.safetensors` and installs it **only if its SHA-256
matches `SHA256SUMS`**, so the result is byte-for-byte the model that was trained and evaluated.

| `--source` | Where it downloads from | Needs |
|---|---|---|
| `hf-mirror` (default) | `unsloth/gemma-3-270m-it`, pinned revision. Public; weights byte-identical to Google's | nothing |
| `hf-official` | `google/gemma-3-270m-it`, pinned revision | `HF_TOKEN` + Gemma license accepted on huggingface.co |
| `azure` | any URL you host, e.g. an Azure Blob SAS URL (`MODEL_WEIGHTS_URL`) | your storage |

Only the weights file comes from the download. The configs stay Google's originals from git;
the unsloth mirror edits its configs (e.g. `eos_token_id`), and that would change generation.

## Severity policy the model was trained on

Copied verbatim from the training instruction:

- **P1**: critical service unavailable across multiple departments and at least two sites, with no safe workaround.
- **P2**: multiple users affected within one department while other departments remain operational.
- **P3**: one user or endpoint affected while others work normally.
- **P4**: no material service interruption and low business impact.

## How to load it

The backend does this when `INFERENCE_PROVIDER=gemma` (see `backend/.env.example`):

```
BASE_MODEL_PATH=models/gemma3-270m-severity/base
ADAPTER_PATH=models/gemma3-270m-severity/adapter
```

Standalone (Python, with torch, transformers ≥ 4.56 and peft installed):

```python
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer
from peft import PeftModel

tok = AutoTokenizer.from_pretrained("adapter")
base = AutoModelForCausalLM.from_pretrained("base", dtype=torch.float32, local_files_only=True)
model = PeftModel.from_pretrained(base, "adapter").eval()

instruction = "Classify ONLY the incident severity ..."   # exact text: gemma_prompt.SEVERITY_INSTRUCTION
messages = [{"role": "user", "content": instruction + "\n\n" + incident_text}]
prompt = tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
inputs = tok(prompt, return_tensors="pt", add_special_tokens=False)   # template already adds <bos>
with torch.inference_mode():
    out = model.generate(**inputs, max_new_tokens=32, do_sample=False)
print(tok.decode(out[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True))  # {"severity":"P2"}
```

The prompt format must match training exactly: one user turn of
`instruction + "\n\n" + incident text`, greedy decoding, and no extra BOS token.

## Training

| Setting | Value |
|---|---|
| Data | `training/data/severity_train_v1.jsonl` (320 rows, 80 per class) and `severity_val_v1.jsonl` (80 rows), built by `build_severity_dataset.py` from the synthetic v3 incident dataset |
| LoRA | r = 8, alpha = 16, dropout = 0.05, targets `q_proj k_proj v_proj o_proj` |
| Optimiser | AdamW, lr 5e-5, gradient accumulation 4, 5 epochs, seed 42, float32 |
| Loss | Response tokens only (prompt masked); best epoch selected by validation loss |
| Max length | 384 tokens (prompt + answer) |

To retrain, run `python training/scripts/train_severity_lora.py`. The script writes to
`training/outputs/gemma3-270m-severity-lora/best_adapter`; copy that over `adapter/` afterwards.

## Evaluation

| Evaluation | Prompt format | Result |
|---|---|---|
| `training/scripts/evaluate_severity_lora.py` on the 100-row held-out test split | eval-script variant (`"Incident:\n"` prefix, double BOS) | 93/100 (93%), macro-F1 0.930; all errors were P1→P2 or P4→P2 (`training/outputs/severity_test_predictions.json`) |
| Same 100-row test split, re-measured 2026-10-10 | training format (what the app uses) | **100/100**, 25/25 per class; mean loss 0.0001 (base model without adapter: 2.47) |
| App ticket queue: the first 50 rows of the same test split, through the live API, MPS (2026-10-10) | training format (what the app uses) | **50/50 (100%)**, 0 invalid outputs, mean 269 ms per ticket |
| Validation-split parity check (`backend/scripts/verify_gemma_provider.py`) | training format | 40/40 |

## Limitations

- **Synthetic, templated data.** Every training and test example follows the same
  narrative template ("… Business impact: … Diagnostic evidence: … Scope check: …").
  The high scores above apply to that distribution only.
- **Weak on free-form text.** Hand-written incidents, such as those from the Manual triage
  form, are often misclassified. For example, a clear P1-style scope was predicted as P3.
  Real-world use would need privacy-scrubbed, SME-labelled real tickets and a separate
  real-world test set.
- **No confidence score.** The model emits only a label. Every result requires human review.
