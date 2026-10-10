# Model Development: Fine-tuning Gemma 3 270M for Incident Severity

This document records how the project's model was built. It covers which models were tried,
what data it was trained on, what goes in and comes out, how training was set up, what the
loss and accuracy are, and what the model can and cannot do.

> **Sources.** The facts below come from the training scripts, datasets and output files in
> `training/`, plus measurements re-run on 2026-10-10 against the shipped model files.
> **The loss values in §6 were re-measured**: the training script printed its losses to the
> terminal but never saved them, so the original per-epoch values are not available.

---

## 1. Goal and constraints

**Goal.** Given an IT incident description, suggest a severity of **P1, P2, P3 or P4** that a
service-desk engineer then reviews.

**Constraints**

| Constraint | Consequence |
|---|---|
| Development machine: **MacBook Air M1, 8 GB unified memory** | Training must fit in a few GB, on Apple MPS or CPU |
| Must run **locally**, later on a modest cloud VM | Small model, fast CPU/GPU inference, no paid API |
| Output feeds an application | Strict, machine-parseable output; anything else is rejected |
| Real incident data not available | Train on **controlled synthetic data**; be explicit about that limitation |

---

## 2. Timeline (6–10 October 2026)

| Date | Step | Outcome |
|---|---|---|
| 6 Oct | Set up the environment; loaded **SmolLM2-360M-Instruct** (`load_model.py`, `inference.py`) | Toolchain working |
| 7–8 Oct | First LoRA exercise: **SmolLM2-360M** on 41 Q&A pairs (`turing_training.jsonl`, `train_lora.py`, TRL `SFTTrainer`) | Learned the LoRA mechanics |
| 8 Oct | Explored **Gemma 3 1B IT** (`gemma_chat.py`, `gemma_inference.py`) and Gemma tokenization | Gemma chat template understood |
| 9 Oct | Moved to **Gemma 3 270M IT** for incidents: baseline (`incident_baseline.py`), first incident LoRA (`incident_lora_scripts/`) | v1 data had an evaluation flaw (below) |
| 9 Oct | **Dataset v2**: 1,000 synthetic incidents, stratified so every root cause appears in every split | Fixed the v1 split problem |
| 9 Oct | **Dataset v3**: severity wording aligned with scope; every target carries scope evidence | Training data for everything after this |
| 9–10 Oct | **Multi-field LoRA** on v3 (category, severity, root cause, evidence, actions) | Category 100%, root cause 100%, **severity only 43%** |
| 10 Oct | **Severity-only LoRA** (`build_severity_dataset.py`, `train_severity_lora.py`) | **93/100** test (evaluation-script format); **100/100** in the app's training format |
| 10 Oct | Integrated into the FastAPI + Next.js app; ticket queue and evaluation views | 50/50 live via the API |

The v2 dataset README records the v1 problem: some root-cause labels did not appear in every
split, so the test set contained classes the model never saw. v2 was regenerated so that
"every root-cause label appears in all splits", with no duplicate inputs across splits.

---

## 3. Why a small model: Gemma 3 270M

Three model sizes were used during the project. Only Gemma 3 270M was fine-tuned for the incident task.

| Model | Parameters | Role in this project |
|---|---|---|
| SmolLM2-360M-Instruct | 360 M | First experiments and the first LoRA exercise |
| Gemma 3 1B IT | 1 B | Explored for chat and inference |
| **Gemma 3 270M IT** | **268 M** (measured) | **All incident training and the shipped model** |

**Why 270M was the right fit:**

1. **It fits the hardware with room to spare.**
   - All training scripts use full **float32** precision. 268 M parameters × 4 bytes is about 1.07 GB of weights; the running app holds **1,089 MB** of GPU memory (measured).
   - Training adds activations, gradients for the LoRA weights and optimizer state, which is still comfortable on an 8 GB machine.
   - A 1B model in float32 needs about 4 GB for weights alone, which leaves little headroom on 8 GB of memory that is shared with macOS.
2. **The task is narrow.** Choosing one of four labels from a structured narrative doesn't need a large model's broad knowledge. The results bear this out: on in-distribution data the 270M adapter reaches 100% (§7).
3. **Inference is fast and cheap.**
   - Measured per ticket: **~270 ms on Apple MPS** and **~410 ms on CPU**.
   - CPU-only serving is practical, which keeps a future cloud VM small and inexpensive.
4. **It's instruction-tuned and has an open-weight license.** The `-it` variant already follows a chat format and emits JSON reliably. The Gemma terms allow fine-tuning and redistribution with the notice.

**What was not done:** no head-to-head comparison of 270M vs 1B on the incident task was run.
A larger model might generalise better to free-form text (§8), but that is untested.

---

## 4. The data

### 4.1 How the incidents are made

`training/scripts/generate_dataset.py` composes incidents from a fixed taxonomy (`training/docs/`):

- **10 categories**: identity, authentication, conditional access, device compliance, endpoint, network, Teams, Exchange, SharePoint, security.
- **20 root causes**, each with curated diagnostic evidence.
- **4 severities**, each with fixed *business impact* and *scope check* sentences.
- Varied context: role, site, device, onset time and an additional-context sentence.

Each incident is one paragraph in a fixed template:

```
<who/where/what narrative>. Business impact: <severity-specific>. Diagnostic evidence: <cause-specific>.
Scope check: <severity-specific>. Additional context: <neutral detail>.
```

`validate_dataset.py` checks the schema, labels, JSON validity, class balance and duplicates (`dataset_report_v3.json`: **PASS**).

### 4.2 How many examples, and why

You may remember "about 1,500 examples"; the files show different numbers:

| Dataset | Train | Val | Test | Total | Used for |
|---|---:|---:|---:|---:|---|
| v2 incidents | 800 | 100 | 100 | 1,000 | Superseded by v3 |
| v3 incidents | 800 | 100 | 100 | 1,000 | Multi-field LoRA; source of everything below |
| **Severity v1** (derived from v3 train) | **320** | **80** | — | **400** | **The shipped severity adapter** |
| Test set for the severity model | — | — | 100 | 100 | `incident_test_v3.jsonl`, never used in training |
| App ticket queue | — | — | — | 50 | The first 50 rows of the v3 test split |

How the severity set was built (`build_severity_dataset.py`):

1. Take the 800 v3 training incidents. They hold 200 per severity.
2. Randomly pick **100 per severity** (seed 42), giving 400 incidents.
3. Split each class **80 / 20**, giving 320 train and 80 validation rows, **perfectly balanced**.
4. Replace the multi-field target with severity only: `{"severity":"P3"}`.

Why these sizes:

- **Balance matters more than volume here.** Equal counts per class stop the model from learning to favour a majority label.
- **The task is easy to learn on this data.** Severity is stated by the business-impact and scope sentences, so a few hundred examples suffice. Validation loss and accuracy confirm the model learned it (§6, §7).
- **It keeps training cheap on the M1.** 320 examples × 5 epochs is 1,600 forward/backward passes.
- **The test split stays untouched.** All 100 test incidents are reserved for evaluation.

More examples of the *same* template would add little. Better generalisation needs *different*
data: real, varied tickets (§9).

---

## 5. Input and output

### 5.1 What the model receives

A single chat turn: the **fixed instruction**, a blank line, then the **incident text**.
Nothing else is added: no title and no label.

The instruction, verbatim from `build_severity_dataset.py`:

> Classify ONLY the incident severity using the documented business impact and confirmed scope.
> Apply these rules: P1 = critical service unavailable across multiple departments and at least
> two sites, with no safe workaround; P2 = multiple users affected within one department while
> other departments remain operational; P3 = one user or endpoint affected while others work
> normally; P4 = no material service interruption and low business impact. Prioritize confirmed
> business impact and scope over technical symptoms. Return only valid JSON in the form
> {"severity":"P1"}, using exactly one of P1, P2, P3, or P4.

A real example, ticket `ITSM-13-041` (incident text):

> A HR specialist at the Bengaluru office reports that SharePoint Online is failing on a corporate
> MacBook after a device restart. Business impact: multiple users in one department are blocked
> from a time-sensitive business workflow, with only a limited workaround. Diagnostic evidence:
> SharePoint returns access denied for the target library while the site is reachable.. Scope
> check: The service desk confirmed multiple affected users in one department; other departments
> remain operational. Additional context: The issue has not been reproduced on an unrelated endpoint.

After Gemma's chat template is applied, this is what the model sees (226 tokens):

```
<bos><start_of_turn>user
Classify ONLY the incident severity … using exactly one of P1, P2, P3, or P4.

A HR specialist at the Bengaluru office … not been reproduced on an unrelated endpoint.<end_of_turn>
<start_of_turn>model
```

Training prompts average **238 tokens** (max 258), well under the 384-token training limit.

### 5.2 What the model returns

```
{"severity":"P2"}
```

That is 8 tokens: `{"` `severity` `":"` `P` `2` `"}` `<end_of_turn>` `\n`. Generation is greedy
(deterministic), so the same text always gives the same answer.

The application accepts **only** that exact shape with P1–P4. Anything else is reported as
*invalid model output* and never turned into a prediction (`backend/app/services/severity_parser.py`).

### 5.3 What the model is *not* given

The reference label (`expected_severity`) is never part of the input; it is compared only
after the model answers. Automated tests in `backend/tests/test_tickets.py` verify this.

---

## 6. Training

### 6.1 Method: LoRA

LoRA (Low-Rank Adaptation) freezes all 268 M original weights and trains small "adapter"
matrices added to the attention layers. Only those adapter matrices are saved, which is why the
adapter is **2.8 MB** of weights rather than a full copy of the model.

| Setting | Value | Why |
|---|---|---|
| Base model | `google/gemma-3-270m-it`, revision `ac82b4e8…` | Instruction-tuned; follows the chat format |
| Trainable parameters | **737,280 (0.27%)** of 268,098,176 (measured) | Cheap to train; hard to destroy the base model's abilities |
| LoRA rank `r` / `alpha` / dropout | 8 / 16 / 0.05 | Standard small-adapter settings |
| Target modules | `q_proj`, `k_proj`, `v_proj`, `o_proj` | The attention projections in every layer |
| Optimiser | AdamW, learning rate **5e-5** | Low rate for stable fine-tuning |
| Batch | 1 example, gradients accumulated over **4** (effective batch 4) | Fits in memory on the M1 |
| Epochs | **5**, best epoch kept by **validation loss** | Guards against overfitting |
| Precision / device | float32 on Apple MPS | Numerically stable on MPS |
| Max length | 384 tokens | All examples fit (max 258 + 8) |
| Seed | 42 | Reproducible |

**Loss masking.** The loss is computed **only on the 8 response tokens**; the 226-ish prompt
tokens are masked out (label −100). The model is trained to *answer*, not to repeat the prompt.

To reproduce: `cd training && python scripts/train_severity_lora.py` (see `training/README.md`).

### 6.2 Loss (re-measured)

Mean cross-entropy loss per response token, computed exactly the way training computes it.
The "Base model" column has the adapter switched off:

| Split | Rows | Base model (no adapter) | **With adapter** |
|---|---:|---:|---:|
| Train | 320 | 2.472 | **0.0001** |
| Validation | 80 | 2.482 | **0.0002** |
| Test (never trained on) | 100 | 2.465 | **0.0001** |

**How to read this:**

- **Base model, loss ≈ 2.47.** Before fine-tuning, the model is unsure what to output; on average it gives the correct next token only about e^−2.47 ≈ 8% probability.
- **With adapter, loss ≈ 0.0001.** The model now puts almost all probability on the correct answer. Train, validation and test losses are equal, so this is **not overfitting** to the training rows.
- **Why it's this close to zero.** Seven of the eight response tokens are fixed formatting (`{"`, `severity`, …). Only one token, the digit, carries the decision, so the average is dominated by easy tokens. The accuracy results in §7 are the more meaningful measure.
- **The limits of this number.** A near-zero loss on these sets shows the model mastered **this synthetic template**. It says nothing about free-form, real-world tickets (§8).

The original training run printed per-epoch train and validation loss to the terminal, but
those values were not saved. Future runs should write them to a file.

---

## 7. Results

### 7.1 Each iteration

| Model | Task | Severity accuracy (test, n = 100) | Notes |
|---|---|---:|---|
| Gemma 3 270M base, no fine-tuning | Multi-field JSON | **7%** | Valid JSON 99%; category 1%, root cause 0% |
| Multi-field LoRA (v3, 800 rows, 3 epochs) | Category + severity + root cause + evidence + actions | **43%** | Category **100%**, root cause **100%**, valid JSON 100% |
| **Severity-only LoRA** (320 rows, 5 epochs) | Severity only | **93%** (evaluation-script format) | Macro-F1 0.930; errors: 6 × P1→P2, 1 × P4→P2 |
| Same adapter | Severity only | **100%** (training format, as used by the app) | Re-measured 2026-10-10; 25/25 in every class |
| Same adapter, live app | 50-ticket queue via the API | **100%** (50/50) | Mean 269–271 ms per ticket on MPS |

### 7.2 What the results taught us

1. **One job per small model.**
   - The multi-field adapter learned category and root cause perfectly but got severity right only 43% of the time.
   - Asked to do everything at once, a small model favoured the easy, cause-specific fields. A dedicated severity adapter fixed it.
   - The same multi-field evaluation also used the prompt variant in lesson 2, which may have cost it some accuracy; that was not re-measured.
2. **The prompt must match training exactly.**
   - The evaluation script added `"Incident:\n"` before the text and a second `<bos>` token.
   - That small difference cost 7 points (93% vs 100%).
   - The app uses the exact training format; `backend/app/services/providers/gemma_prompt.py` documents both variants.
3. **Strict output contracts are cheap insurance.** The model produced valid JSON on every test (0 invalid outputs), and the app still rejects anything malformed rather than guessing.

### 7.3 Confusion matrix (100-row test, training format)

|  | → P1 | → P2 | → P3 | → P4 |
|---|---:|---:|---:|---:|
| **P1** | 25 | 0 | 0 | 0 |
| **P2** | 0 | 25 | 0 | 0 |
| **P3** | 0 | 0 | 25 | 0 |
| **P4** | 0 | 0 | 0 | 25 |

---

## 8. Limitations: what the model cannot do (yet)

- **Free-form text.** The model learned to read the template's *Business impact* and
  *Scope check* sentences. When those are written differently, accuracy drops sharply.
  - Four hand-written incidents were typed into the app's Manual triage form; the model got the P3 and P4 ones right but **predicted P3 for both the P1-style and the P2-style incident**.
  - A counter-test confirms the model reads the scope text: changing only the scope sentences of one ticket moves the prediction through P1, P2, P3 and P4 correctly. But it only understands the phrasing it was trained on.
- **Synthetic data only.** No real tickets were used, so the 100% results describe the generator, not production incidents.
- **No confidence score.** The model emits a label only. Every result is marked *Human review required*.
- **English, single paragraph.** That is all the training data contains.

## 9. Next steps

1. **Collect real data.** Gather privacy-scrubbed, real incident tickets labelled by IT subject-matter experts, and keep a separate real-world test set.
2. **Add varied phrasing.** Paraphrased and structured inputs (like the Manual triage form) in training would close the free-form gap.
3. **Log training metrics to a file.** Per-epoch train and validation loss, saved with the adapter.
4. **Compare model sizes on real data.** Re-evaluate Gemma 3 1B against 270M once real data exists; quantisation (int8/4-bit) could offset the larger size.
5. **Consider a calibrated confidence.** For example, from the label token's probability, but only once validated on real data.

---

## Appendix: file map

| What | Where |
|---|---|
| Shipped adapter + model card | `backend/models/gemma3-270m-severity/` |
| Base weights download (checksum-verified) | `backend/scripts/download_model.py` |
| Prompt construction used by the app | `backend/app/services/providers/gemma_prompt.py` |
| Output validation | `backend/app/services/severity_parser.py` |
| Dataset generator / validator | `training/scripts/generate_dataset.py`, `validate_dataset.py` |
| Severity dataset builder | `training/scripts/build_severity_dataset.py` |
| Training script (shipped adapter) | `training/scripts/train_severity_lora.py` |
| Evaluation script + report | `training/scripts/evaluate_severity_lora.py`, `training/outputs/severity_test_predictions.json` |
| Multi-field experiment + metrics | `training/scripts/train_lora_v3.py`, `train_lora_resumable.py`, `training/outputs/evaluation_metrics_v3.json` |
| Datasets | `training/data/` |
