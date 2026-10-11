# Fine-tuning Case Study: IT Incident Severity Classification with Gemma 3 270M + LoRA

**One-line summary.** I fine-tuned Google's **Gemma 3 270M** instruction model with a
**2.8 MB LoRA adapter** (737K trainable parameters, 0.27% of the model) to classify enterprise
IT incidents into **P1–P4 severity**. On a 100-ticket held-out test set, accuracy went from
**7% to 100%** and loss from **2.47 to 0.0001**. The model is served through a FastAPI inference
API with strict JSON output validation and an evaluation pipeline.

Repository: https://github.com/Atifelx/AI_Triage

---

## 1. Problem

Enterprise IT service desks receive large volumes of incident tickets. An engineer has to read
each one and decide how urgent it is before routing it. The goal was a model that **reads an
incident narrative and suggests a severity**, which a human engineer then confirms.

| Severity | Policy the model learned |
|---|---|
| **P1 — Critical** | Critical service unavailable across multiple departments and at least two sites, with no safe workaround |
| **P2 — High** | Multiple users affected within one department; other departments operational |
| **P3 — Medium** | One user or endpoint affected; others work normally |
| **P4 — Low** | No material service interruption; low business impact |

**Design requirements**

- Runs locally and cheaply, with no paid API and fast CPU/GPU inference.
- Strict, machine-readable output that an application can trust, and rejects otherwise.
- The model never sees the correct label at inference time; labels are used only for evaluation.

---

## 2. Results at a glance

| Metric | Before fine-tuning | After fine-tuning |
|---|---:|---:|
| Severity accuracy, 100-ticket held-out test | **7%** ¹ | **100%** (100/100) |
| Mean loss on response tokens, test set | **2.465** | **0.0001** |
| Mean loss, validation set | 2.482 | 0.0002 |
| Valid JSON output | 99% ¹ | **100%** (0 invalid) |
| Live API run, 50 queued tickets | — | **50/50 correct** |
| Inference latency per ticket | — | **~0.27 s GPU / ~0.41 s CPU** |
| Trainable parameters | — | **737,280** (0.27% of 268M) |
| Adapter weights size | — | **2.8 MB** |

¹ Base model measured on the original multi-field triage prompt (§7.1).

---

## 3. Why Gemma 3 270M

| Criterion | Gemma 3 270M IT |
|---|---|
| Size | 268,098,176 parameters; 511 MB of float32 weights; about 1.1 GB in memory when served |
| Instruction-tuned | Yes (`-it`); already follows a chat format and emits valid JSON 99% of the time before fine-tuning |
| Task fit | The task is narrow: one of four labels from a structured narrative. It doesn't need a large model's world knowledge |
| Serving cost | Fast enough to serve on CPU (~0.41 s per ticket), so no GPU server is required |
| License | Open weights under the Gemma Terms of Use; fine-tuning and redistribution permitted with notice |

**Models considered**

- SmolLM2-360M-Instruct and Gemma 3 1B-IT were explored during prototyping.
- Gemma 3 270M was chosen as the smallest model that met the requirements. It reached 100% on the target task, so a larger model wasn't needed for this data.
- No head-to-head benchmark against 1B was run on this task.

**Why LoRA instead of full fine-tuning**

- Only 0.27% of the weights are trained, so training is fast and memory-light.
- The adapter is a 2.8 MB file that can be versioned in git.
- The base model is untouched, so its general language ability is preserved and the adapter can be swapped or rolled back.

---

## 4. Data

### 4.1 Synthetic incident generator

Real incident data was not available, so a **controlled synthetic dataset** was generated from a fixed taxonomy:

- **10 categories**: authentication, conditional_access, device_compliance, endpoint, exchange, identity, network, security, sharepoint, teams.
- **20 root causes** (2 per category), each with curated diagnostic evidence and approved remediation actions.
- **4 severities**, each with fixed business-impact and scope-check language.
- Varied context: reporter role, site, device, symptom onset and an additional-context sentence.

Each incident is a single paragraph following one template:

```
<narrative: who, where, which service, which device, when>. Business impact: <severity-specific>.
Diagnostic evidence: <cause-specific>. Scope check: <severity-specific>. Additional context: <neutral detail>.
```

Quality gates, enforced by a validator script (status: **PASS**):

- valid schema and labels;
- valid JSON targets;
- class balance;
- **zero duplicate inputs** within and across splits;
- every root cause present in every split.

### 4.2 Dataset sizes

| Dataset | Train | Validation | Test | Notes |
|---|---:|---:|---:|---|
| Full incident set (v3) | 800 | 100 | 100 | Balanced: 200 per severity, 80 per category, 40 per root cause (train) |
| **Severity fine-tuning set** | **320** | **80** | — | 100 per severity sampled from the 800 train rows (seed 42), split 80/20 per class |
| **Held-out test set** | — | — | **100** | 25 per severity; never used for training or model selection |
| Live ticket queue | — | — | 50 | The first 50 test incidents, served through the API |

**Why 320 training examples was enough**

- Balanced classes (80 per severity) prevent label bias.
- The task signal is explicit in the business-impact and scope sentences, so a few hundred examples teach the mapping.
- Train, validation and test losses converged to the same near-zero value, which confirms the model learned rather than memorised (§7.2).

### 4.3 Dataset iterations

| Version | Change | Reason |
|---|---|---|
| v1 | Initial incident set | Some root-cause classes were missing from some splits, which made evaluation invalid |
| v2 | 1,000 rows, stratified by root cause | Every class appears in train, validation and test |
| v3 | Severity language aligned explicitly to scope; scope evidence in every target | Severity must be derivable from stated business impact and scope |
| Severity v1 | Severity-only targets, balanced 100 per class | A small model learns one focused task better than five at once (§7.1) |

---

## 5. Input and output

### 5.1 Instruction (fixed, identical in training and inference)

```
Classify ONLY the incident severity using the documented business impact and confirmed scope.
Apply these rules: P1 = critical service unavailable across multiple departments and at least
two sites, with no safe workaround; P2 = multiple users affected within one department while
other departments remain operational; P3 = one user or endpoint affected while others work
normally; P4 = no material service interruption and low business impact. Prioritize confirmed
business impact and scope over technical symptoms. Return only valid JSON in the form
{"severity":"P1"}, using exactly one of P1, P2, P3, or P4.
```

### 5.2 How a ticket is processed

```
ticket.description (text only; no title, no label)
        │
        ▼
user message = INSTRUCTION + "\n\n" + description
        │
        ▼
Gemma chat template:
  <bos><start_of_turn>user\n{message}<end_of_turn>\n<start_of_turn>model\n
        │  tokenized without extra special tokens (template already adds <bos>); ~238 tokens on average
        ▼
Gemma 3 270M + LoRA adapter, greedy decoding (deterministic), max 32 new tokens
        │
        ▼
raw text:  {"severity":"P2"}      ← 8 tokens: {"  severity  ":"  P  2  "}  <end_of_turn>  \n
        │
        ▼
strict validator: must parse as JSON, exactly one key "severity", value in {P1,P2,P3,P4}
        │                                   └─ anything else → HTTP 502 invalid_model_output (never guessed)
        ▼
API response, with the reference label attached only AFTER inference, for evaluation
```

---

## 6. Training

### 6.1 Configuration

| Parameter | Value |
|---|---|
| Base model | `google/gemma-3-270m-it` (pinned revision `ac82b4e8…`) |
| Method | LoRA (PEFT) |
| LoRA rank `r` | 8 |
| LoRA alpha | 16 (scaling α/r = 2) |
| LoRA dropout | 0.05 |
| Target modules | `q_proj`, `k_proj`, `v_proj`, `o_proj` (all attention projections, every layer) |
| Trainable parameters | **737,280** of 268,098,176 (**0.27%**) |
| Optimizer | AdamW |
| Learning rate | 5e-5 |
| Batch size | 1, with gradient accumulation over 4 (effective batch 4) |
| **Epochs** | **5** |
| Training examples | **320** (80 per class) |
| Forward/backward passes | 1,600 (320 × 5) |
| Optimizer updates | 400 (80 per epoch) |
| Model selection | Checkpoint with the **lowest validation loss** across the 5 epochs |
| Max sequence length | 384 tokens (longest example: 258 prompt + 8 response) |
| Precision | float32 |
| Seed | 42 |
| Loss | Causal-LM cross-entropy on **response tokens only**; prompt tokens masked with label −100 |

**Why response-only loss.** The model is trained to produce the answer, not to reproduce the
instruction or ticket text. All of the gradient goes to the decision.

### 6.2 Loss

Mean cross-entropy per response token, measured on the final artifacts (the base model with the
adapter disabled, versus the fine-tuned adapter):

| Split | Rows | Before (epoch 0, base model) | After (selected checkpoint) | Reduction |
|---|---:|---:|---:|---:|
| Train | 320 | 2.472 | 0.0001 | >99.99% |
| Validation | 80 | 2.482 | 0.0002 | >99.99% |
| Test (unseen) | 100 | 2.465 | 0.0001 | >99.99% |

**Interpretation**

- **Before (loss 2.47).** The base model assigns on average about 8% probability (e^−2.47) to the correct next response token.
- **After (loss ≈ 0.0001).** The model is effectively certain of the correct answer.
- **No overfitting.** Train, validation and test losses are equal.
- **Why the value is so close to zero.** Seven of the eight response tokens are fixed formatting; one token carries the label, so the mean is dominated by easy tokens. Accuracy (§7) is the more informative metric.

**Per-epoch loss.** The training script printed train and validation loss after each of the 5
epochs, but did not write them to a file, so the intermediate values (epochs 1–4) are not
available. Only the epoch-0 baseline and the selected checkpoint above were measured. Re-running
training with metric logging reproduces the full curve.

### 6.3 Adapter artifact

| File | Size | Content |
|---|---:|---|
| `adapter_model.safetensors` | **2.8 MB** (2,967,872 bytes) | LoRA weights (737,280 float32 parameters) |
| `adapter_config.json` | 1.1 KB | LoRA configuration (below) |
| `tokenizer.json`, `tokenizer_config.json`, `chat_template.jinja` | 32 MB | Tokenizer and chat template saved with the adapter |
| **Total adapter folder** | **35 MB** | Versioned in git; the base weights (511 MB) are downloaded separately and checksum-verified |

```json
{
  "peft_type": "LORA",
  "task_type": "CAUSAL_LM",
  "base_model_name_or_path": "google/gemma-3-270m-it",
  "r": 8,
  "lora_alpha": 16,
  "lora_dropout": 0.05,
  "target_modules": ["k_proj", "o_proj", "v_proj", "q_proj"],
  "bias": "none",
  "inference_mode": true,
  "peft_version": "0.21.2"
}
```

---

## 7. Evaluation

### 7.1 Model iterations, measured on the 100-ticket held-out test set

| Model | Task | Severity accuracy | Other metrics |
|---|---|---:|---|
| Gemma 3 270M base | Multi-field triage JSON | **7%** | Category 1%, root cause 0%, valid JSON 99% |
| Multi-field LoRA (800 rows, 3 epochs) | Category + severity + root cause + evidence + actions | **43%** | Category 100%, root cause 100%, valid JSON 100% |
| **Severity LoRA (320 rows, 5 epochs)** | **Severity only** | **100%** | Valid JSON 100%; 0 invalid outputs |

**Finding: specialisation beats multi-tasking at this scale.** Asked to produce five fields at
once, the 270M model learned the cause-specific fields but not severity. A dedicated severity
adapter, trained on 2.5× fewer examples, reached 100%.

### 7.2 Final model: confusion matrix (100 test tickets)

| Expected ↓ / Predicted → | P1 | P2 | P3 | P4 |
|---|---:|---:|---:|---:|
| **P1** | 25 | 0 | 0 | 0 |
| **P2** | 0 | 25 | 0 | 0 |
| **P3** | 0 | 0 | 25 | 0 |
| **P4** | 0 | 0 | 0 | 25 |

Precision, recall and F1 are **1.00 for every class**.

### 7.3 Prompt-format sensitivity

The same adapter scored **93/100** (macro-F1 0.930) when evaluated with a slightly different
prompt: an extra `"Incident:\n"` prefix and a duplicate `<bos>` token. All 7 errors were
P1→P2 (6) or P4→P2 (1). In the exact training format it scores **100/100**.

**Lesson:** inference must reproduce the training prompt byte-for-byte. The serving code
builds the prompt with the same template and tokenization settings as training.

### 7.4 Additional verification

| Test | Result |
|---|---|
| Validation-set parity check (40 rows, through the serving code path) | 40/40 valid JSON, 40/40 correct |
| Live API run (50 queued tickets, end-to-end over HTTP) | 50/50 correct, 0 invalid, mean 271 ms |
| **Counterfactual test**: same ticket, only the scope sentences rewritten | Prediction followed the text: P2 → P1 → P3 → P4, with the reference label constant. The model reads the scope rather than memorising tickets |
| Label isolation | Automated tests confirm the provider receives only the description; the label is attached after inference |
| Reproducibility | Fresh clone from GitHub, with weights downloaded and verified by SHA-256: 50/50 |

---

## 8. End-to-end JSON data

All examples below are real records and responses from the project. Long texts are shortened with `…`.

### 8.1 Training record (`severity_train_v1.jsonl`)

```json
{
  "id": "ITSM-20-008",
  "category": "security",
  "severity": "P4",
  "root_cause": "legacy_auth_blocked",
  "instruction": "Classify ONLY the incident severity using the documented business impact and confirmed scope. Apply these rules: … Return only valid JSON in the form {\"severity\":\"P1\"}, using exactly one of P1, P2, P3, or P4.",
  "input": "A ticket was opened for identity security controls for a finance analyst at the regional office; the affected device is a corporate MacBook, and symptoms began after a password change. Business impact: the user requests guidance or reports a minor issue; core service functionality remains available. Diagnostic evidence: Sign-in logs identify a legacy authentication client blocked by tenant policy for one user.. Scope check: Triage confirms no material service interruption; core functionality remains available and the request is low impact. Additional context: The support agent recorded the current workaround status.",
  "output": "{\"severity\":\"P4\"}"
}
```

Only `instruction`, `input` and `output` are used for training. `category` and `root_cause` are metadata.

### 8.2 Original multi-field target (v3 dataset, used by the multi-field experiment)

```json
{
  "category": "network",
  "severity": "P4",
  "root_cause": "dns_resolution_failure",
  "evidence": [
    "Several endpoints at different sites return failures for the same service hostname, and DNS telemetry shows a common record problem.",
    "Triage confirms no material service interruption; core functionality remains available and the request is low impact."
  ],
  "recommended_actions": [
    "Compare the failing record with authoritative DNS data and escalate stale or missing records to the DNS owner."
  ],
  "human_review_required": true
}
```

### 8.3 Queued ticket (`backend/data/tickets.jsonl`)

```json
{
  "ticket_id": "ITSM-13-041",
  "title": "Incident ITSM-13-041",
  "description": "A HR specialist at the Bengaluru office reports that SharePoint Online is failing on a corporate MacBook after a device restart. Business impact: multiple users in one department are blocked from a time-sensitive business workflow, with only a limited workaround. Diagnostic evidence: SharePoint returns access denied for the target library while the site is reachable.. Scope check: The service desk confirmed multiple affected users in one department; other departments remain operational. Additional context: The issue has not been reproduced on an unrelated endpoint.",
  "expected_severity": "P2"
}
```

`expected_severity` stays on the server and is never sent to the model.

### 8.4 Model input and raw output

```text
<bos><start_of_turn>user
Classify ONLY the incident severity … using exactly one of P1, P2, P3, or P4.

A HR specialist at the Bengaluru office reports that SharePoint Online is failing … not been reproduced on an unrelated endpoint.<end_of_turn>
<start_of_turn>model
```

```json
{"severity":"P2"}
```

### 8.5 `GET /api/v1/tickets/next`: issue the next ticket (label withheld)

```json
{
  "ticket": {
    "ticket_id": "ITSM-13-041",
    "title": "Incident ITSM-13-041",
    "description": "A HR specialist at the Bengaluru office reports that SharePoint Online is failing …",
    "position": 2,
    "total": 50
  },
  "exhausted": false,
  "issued": 2,
  "total": 50,
  "message": null
}
```

### 8.6 `POST /api/v1/tickets/ITSM-13-041/analyze`: live inference result

```json
{
  "request_id": "5cacdb4213a3464aae91767eda848288",
  "ticket_id": "ITSM-13-041",
  "incident_title": "Incident ITSM-13-041",
  "severity": "P2",
  "human_review_required": true,
  "provider": "gemma",
  "model_id": "google/gemma-3-270m-it + LoRA:gemma3-270m-severity",
  "is_mock": false,
  "inference_ms": 381.92,
  "created_at": "2026-10-10T15:14:34.004Z",
  "expected_severity": "P2",
  "correct": true
}
```

### 8.7 `GET /api/v1/tickets/evaluation`: evaluation report (full 50-ticket run)

```json
{
  "provider": "gemma",
  "model_id": "google/gemma-3-270m-it + LoRA:gemma3-270m-severity",
  "is_mock": false,
  "total_tickets": 50,
  "analyzed": 50,
  "correct": 50,
  "invalid_outputs": 0,
  "accuracy": 1.0,
  "labels": ["P1", "P2", "P3", "P4"],
  "confusion_matrix": {
    "P1": {"P1": 14, "P2": 0,  "P3": 0,  "P4": 0,  "invalid": 0},
    "P2": {"P1": 0,  "P2": 11, "P3": 0,  "P4": 0,  "invalid": 0},
    "P3": {"P1": 0,  "P2": 0,  "P3": 11, "P4": 0,  "invalid": 0},
    "P4": {"P1": 0,  "P2": 0,  "P3": 0,  "P4": 14, "invalid": 0}
  },
  "results": [
    {
      "ticket_id": "ITSM-13-041",
      "title": "Incident ITSM-13-041",
      "request_id": "5cacdb4213a3464aae91767eda848288",
      "outcome": "predicted",
      "predicted_severity": "P2",
      "expected_severity": "P2",
      "correct": true,
      "provider": "gemma",
      "model_id": "google/gemma-3-270m-it + LoRA:gemma3-270m-severity",
      "is_mock": false,
      "inference_ms": 381.92,
      "analyzed_at": "2026-10-10T15:14:34.004Z"
    }
  ]
}
```

(`results` holds one entry per analyzed ticket. The entry shown is from a separate interactive session and illustrates the record format; the totals and confusion matrix are from the full 50-ticket API run.)

### 8.8 `GET /health`: model readiness

```json
{
  "status": "ok",
  "api_version": "0.1.0",
  "inference": {
    "provider": "gemma",
    "model_id": "google/gemma-3-270m-it + LoRA:gemma3-270m-severity",
    "is_mock": false,
    "state": "ready",
    "ready": true,
    "model_loaded": true,
    "device": "mps",
    "detail": "Model loaded."
  },
  "timestamp": "2026-10-10T15:12:03.783Z"
}
```

### 8.9 Error contract: invalid model output (never converted into a prediction)

```json
{
  "error": {
    "code": "invalid_model_output",
    "message": "The model returned an invalid severity output. No prediction was made.",
    "request_id": "…"
  }
}
```

| HTTP | `code` | When |
|---|---|---|
| 422 | `validation_error` | Malformed request |
| 409 | `ticket_not_issued` | Analyzing a ticket that hasn't been issued yet |
| 503 | `provider_not_ready` / `provider_unavailable` | Model still loading / failed to load |
| 500 | `inference_failed` | Generation raised an exception |
| 502 | `invalid_model_output` | Output was not exactly `{"severity":"P1–P4"}` |

---

## 9. System architecture

```
                 ┌──────────────────────── Training ────────────────────────┐
 taxonomy ──► dataset generator ──► validator ──► severity subset (320/80) ──► LoRA training (5 epochs)
                                                                                   │ best val-loss checkpoint
                                                                                   ▼
                                                                 adapter (2.8 MB) + model card + SHA-256
                 ┌──────────────────────── Serving ─────────────────────────┐
 ticket ──► FastAPI ──► TicketService ──► InferenceProvider interface ──► GemmaSeverityProvider
             │            (label held       ├── MockInferenceProvider       ├── base weights (checksum-verified)
             │             server-side)     └── (pluggable)                 ├── + LoRA adapter, loaded once at startup
             │                                                              └── greedy decode → strict JSON validator
             └──► evaluation: accuracy, confusion matrix, per-ticket results
```

**Engineering highlights**

- **A provider interface separates the API from the model.** Switching between mock and real inference is a configuration change, and the API contract doesn't change.
- **Model loading is reported truthfully.** It happens once, in a background thread. `/health` reports `loading`, `ready` or `unavailable`, never "ready" just because the API is up.
- **Failures are explicit.** There is no silent fallback: a model failure never returns a mock or guessed prediction.
- **Output validation is strict.** Anything other than the exact JSON contract is rejected.
- **The label is isolated.** The reference label stays server-side and is attached only after inference; automated tests verify it never reaches the model.
- **Model distribution is reproducible.** The git repository ships the adapter. The 511 MB base weights are fetched from a pinned source, and installed only if their SHA-256 matches.
- **Device selection is portable.** CUDA, Apple MPS and CPU are chosen automatically, so the same code runs on a laptop or a cloud GPU VM.
- **Tests:**
  - 140 backend tests, covering validation, provider failures, label isolation, evaluation maths and model download;
  - stdlib-only smoke tests against a live API;
  - an end-to-end fresh-clone verification.

**Tech stack**

- **Model:** Python 3.11, PyTorch, Hugging Face Transformers, PEFT (LoRA).
- **Serving:** FastAPI, Pydantic v2, pytest.
- **Weights:** safetensors.
- **Dashboard:** Next.js / TypeScript.

---

## 10. Limitations and next steps

| Limitation | Next step |
|---|---|
| Trained and tested on **synthetic, single-template** data; 100% describes that distribution | Evaluate on privacy-scrubbed, SME-labelled real tickets with a separate real-world test set |
| Free-form or differently-phrased tickets are often misclassified | Add paraphrased and structured inputs to training; compare against Gemma 3 1B |
| Per-epoch training loss was not persisted | Log per-epoch train/validation loss with each training run |
| Severity only (category, root cause, evidence and actions are not served) | Taxonomy-constrained classification, quote-grounded evidence, runbook-based recommended actions |
| No confidence score | Derive one from the label token's probability, calibrated on real data |

---

## 11. Key numbers (quick reference)

| | |
|---|---|
| Base model | Gemma 3 270M IT, 268,098,176 parameters |
| Fine-tuning method | LoRA, r = 8, α = 16, dropout 0.05, attention projections |
| Trainable parameters | 737,280 (0.27%) |
| Adapter weights | 2.8 MB |
| Training data | 320 examples (80 per class) + 80 validation |
| Epochs | 5 (best checkpoint by validation loss) |
| Learning rate / effective batch | 5e-5 / 4 |
| Loss (test) | 2.465 → 0.0001 |
| Accuracy (100-ticket held-out test) | 7% → 100% |
| Invalid outputs | 0 |
| Latency | ~0.27 s per ticket (GPU), ~0.41 s (CPU) |
| Output contract | `{"severity":"P1"\|"P2"\|"P3"\|"P4"}` |
