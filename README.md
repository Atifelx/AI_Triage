# Enterprise AI Incident Triage

**TriageLens.** An IT incident triage application built on a fine-tuned Gemma 3 270M model with two LoRA adapters:

- **`backend/`**: FastAPI service with a provider-based inference layer. The providers are `mock` (synthetic) and `gemma` (Gemma 3 270M IT with the fine-tuned **severity** adapter and the five-field **triage** adapter attached to one base model). It also routes human-approved incidents to Slack, Microsoft Teams, Jira, ServiceNow and a CRM (sandbox mode).
- **`frontend/`**: Next.js (App Router, TypeScript, Tailwind CSS) console with six views: Home, Manual triage, Ticket queue, Reviews, Evaluation and Integrations. It talks to the backend over HTTP only.
- **`training/`**: the scripts and synthetic datasets used to train and evaluate the adapters.

## Documentation

| Document | For |
|---|---|
| **[docs/USER_GUIDE.md](docs/USER_GUIDE.md)** | **Start here.** Install, download the model, run, use each screen, troubleshoot |
| [docs/MODEL_DEVELOPMENT.md](docs/MODEL_DEVELOPMENT.md) | How the model was built: model choice, data, input/output, LoRA training, loss, results, limitations |
| [backend/models/gemma3-270m-severity/README.md](backend/models/gemma3-270m-severity/README.md) | Model card: severity adapter |
| [backend/models/gemma3-270m-triage-v3/README.md](backend/models/gemma3-270m-triage-v3/README.md) | Model card: five-field triage adapter |
| [docs/FINE_TUNING_CASE_STUDY.md](docs/FINE_TUNING_CASE_STUDY.md) | Fine-tuning case study: journey, metrics, model choice |
| [training/README.md](training/README.md) | Training scripts and datasets; how to retrain |

Each full analysis returns **category, severity, root cause, proof and recommended actions**. Severity comes from the dedicated severity adapter; the other fields come from the triage adapter (see [Full triage, review and routing](#full-triage-review-and-routing)). There are no confidence scores. Every result goes to a human reviewer before it reaches a team.

**What's in git and what's downloaded.** The repository contains all code, the fine-tuned **LoRA adapter** (`backend/models/gemma3-270m-severity/adapter`, 35 MB) and the base model's config files. The base model **weights** (511 MB, too large for git) are downloaded once by `backend/scripts/download_model.py`. The script installs them only if their SHA-256 matches the committed checksum, so every installation runs exactly the model that was trained and evaluated.

```
backend/
  app/main.py                     app factory, CORS, request-id middleware, lifespan (provider start/stop)
  app/core/config.py              env-driven Settings, validated at startup
  app/core/logging.py             JSON-lines structured logging
  app/api/routes/health.py        GET /health
  app/api/routes/triage.py        POST /api/v1/triage, GET /api/v1/triage/{request_id}
  app/api/routes/tickets.py       ticket queue: next / session / reset / analyze / evaluation
  app/services/ticket_queue.py    JSONL loader + validation, session queue, post-inference evaluation
  app/api/routes/examples.py      GET /api/v1/examples (50 held-out manual-triage examples)
  app/api/routes/integrations.py  GET /api/v1/integrations, POST /api/v1/dispatch[/preview]
  app/services/triage_parser.py   five-field output validation + post-hoc checks (taxonomy, proof grounding)
  app/services/integrations/      routing rules (team directory, severity fan-out) + vendor connectors
  data/tickets.jsonl              local ticket queue (120 held-out tickets)
  data/examples.jsonl             manual-triage examples (50 held-out incidents)
  models/gemma3-270m-severity/    SEVERITY MODEL: README (model card), NOTICE, SHA256SUMS
    adapter/                      fine-tuned severity LoRA adapter (35 MB, in git)
    base/                         Google's config files (in git) + weights (511 MB, downloaded)
  models/gemma3-270m-triage-v3/   TRIAGE MODEL: five-field LoRA adapter (2.8 MB) + offline evaluation
  app/api/errors.py               uniform error envelope (no stack traces / paths)
  app/schemas/                    Pydantic request/response/error/health contracts
  app/services/triage_service.py  maps API <-> provider, in-memory result history
  app/services/severity_parser.py strict {"severity":"P1..P4"} validation
  app/services/providers/
    base.py                       InferenceProvider interface (readiness, timing, error wrapping, validation)
    mock_provider.py              MockInferenceProvider (synthetic rule, clearly labelled)
    gemma_provider.py             GemmaSeverityProvider (Transformers + PEFT, background load)
    gemma_prompt.py               training-format prompt construction (severity adapter, form rendering)
    gemma_triage_prompt.py        triage-adapter prompt profiles (v3, incident_lora) + taxonomy
    factory.py                    builds the configured provider; never falls back
  tests/                          pytest suite (no model weights needed)
  scripts/download_model.py       fetches + checksum-verifies the base weights (stdlib only)
  scripts/smoke_test.py           end-to-end check against a running API (stdlib only)
  scripts/verify_gemma_provider.py loads the REAL provider and checks it (no FastAPI needed)
  scripts/queue_smoke_test.py     walks the whole ticket queue through a running API
  scripts/trial_adapters.py       raw output of every adapter on held-out + form incidents
  scripts/trial_form_rendering.py measures how form-to-prompt rendering affects accuracy
  scripts/build_demo_data.py      builds tickets.jsonl / examples.jsonl from held-out splits only
training/                         training scripts, datasets and eval reports (copy of the original training repo)
frontend/
  app/                            layout + pages: / (home), /triage, /queue, /reviews, /evaluation, /integrations
  components/                     sidebar, page layout, form, full-triage result (severity ladder, RCA,
                                  proof, recommendations), review modal + queue, dispatch previews
  hooks/useHealth.ts              health polling (API status and model readiness tracked separately)
  lib/api.ts, lib/types.ts        typed API client + contract types
  lib/validation.ts               client-side validation mirroring backend limits
  tests/                          Vitest + Testing Library
```

## Quick start (any machine)

Prerequisites:
- Python 3.11
- Node.js 20.19+ (or 22 LTS) and npm
- About 2 GB free RAM

```bash
git clone https://github.com/Atifelx/AI_Triage.git && cd AI_Triage
```

Backend (terminal 1):

```bash
cd backend && python3.11 -m venv .venv && source .venv/bin/activate && pip install -r requirements-gemma.txt
```
```bash
python scripts/download_model.py && cp .env.example .env
```

Set `INFERENCE_PROVIDER=gemma` in `backend/.env` to use the model. Leave it as `mock` to try the UI without the model. Then start the API:

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Frontend (terminal 2):

```bash
cd frontend && npm install && cp .env.local.example .env.local && npm run dev
```

Open http://localhost:3000. The **Ticket queue** tab runs the model on the 50 bundled tickets, and the **Evaluation** tab shows accuracy and the confusion matrix. API docs (OpenAPI) are at http://localhost:8000/docs.

- **Download sources.** `download_model.py` fetches the weights from a public Hugging Face mirror whose weights are byte-identical to Google's, so no account is needed. Use `--source hf-official` with `HF_TOKEN` for Google's gated repo, or `--source azure` for your own copy; see [Azure](#saving-to-github-and-azure).
- **License.** The model is subject to the [Gemma Terms of Use](https://ai.google.dev/gemma/terms) (`backend/models/gemma3-270m-severity/NOTICE`).
- **Without the weights.** If you start the backend in `gemma` mode before downloading, `/health` reports the model as *unavailable* with the exact command to run. It never falls back to mock.

## On the original development Mac

The existing environment `~/AI-Lab/.venv` already has every package:

```bash
cd ~/Desktop/AI_Triage/backend && source ~/AI-Lab/.venv/bin/activate && uvicorn app.main:app --host 127.0.0.1 --port 8000
```
```bash
cd ~/Desktop/AI_Triage/frontend && npm run dev
```

## Tests

```bash
cd backend && pytest
```
```bash
cd frontend && npm run typecheck && npm test && npm run build
```

Smoke tests against a running API use the Python standard library only:

```bash
cd backend && python scripts/smoke_test.py --wait 120 && python scripts/queue_smoke_test.py --reset
```

## Saving to GitHub and Azure

**GitHub** holds the code and the adapter; the base weights are excluded by `.gitignore`. A normal `git add -A && git commit && git push` is all you need, with no Git LFS.

**Azure Repos (optional mirror).** Push the same repository to a second remote, so both always hold identical code:

```bash
git remote add azure https://dev.azure.com/YOUR-ORG/YOUR-PROJECT/_git/AI_Triage
```
```bash
git push origin main && git push azure main
```

**Azure Blob Storage (optional private model copy).** Keep the complete model there, e.g. as the download source for an Azure VM. With the Azure CLI (this creates billable resources, roughly $0.01–0.02/month for about 600 MB):

```bash
az storage container create --account-name YOURACCOUNT --name models --auth-mode login
```
```bash
az storage blob upload-batch --account-name YOURACCOUNT -d models/gemma3-270m-severity -s backend/models/gemma3-270m-severity --auth-mode login
```

Then install from it on any machine. Create a read-only SAS URL for `base/model.safetensors` in the Azure portal or CLI, and run:

```bash
MODEL_WEIGHTS_URL="https://YOURACCOUNT.blob.core.windows.net/models/gemma3-270m-severity/base/model.safetensors?SAS" python scripts/download_model.py
```

The checksum check applies to every source.

**Sharing as a zip.** Exclude rebuildable and local-only folders:

```bash
cd ~/Desktop && zip -r AI_Triage.zip AI_Triage -x "*/node_modules/*" "*/.next/*" "*/.venv/*" "*/__pycache__/*" "*/.git/*" "*/.claude/*" "*/.env" "*/.env.local"
```

To verify an installed model at any time: `cd backend/models/gemma3-270m-severity && shasum -a 256 -c SHA256SUMS`

## Switching to the real Gemma model

1. Once, from `backend/`: `python scripts/download_model.py` (installs the checksum-verified base weights).
2. In `backend/.env`:
   ```
   INFERENCE_PROVIDER=gemma
   MODEL_ID=google/gemma-3-270m-it
   BASE_MODEL_PATH=models/gemma3-270m-severity/base
   ADAPTER_PATH=models/gemma3-270m-severity/adapter
   TRIAGE_ADAPTER_PATH=models/gemma3-270m-triage-v3/adapter   # enables full triage
   DEVICE=auto
   ```
   After the download, the base model and adapter are both loaded from `backend/models/`, offline. This was verified with an empty Hugging Face cache and offline mode forced. Set `BASE_MODEL_PATH=` (empty) to have transformers fetch `MODEL_ID` from Hugging Face instead; that needs an HF token for the gated Google repo.
3. Restart uvicorn. The model loads once, in a background thread at startup. While it loads, `/health` reports `state: "loading"` and the UI shows **Model loading**, and triage requests return `503 provider_not_ready`. When loading finishes, the state is `ready`.
4. Optional pre-flight check without the API: `python scripts/verify_gemma_provider.py --base-model-path models/gemma3-270m-severity/base --adapter-path models/gemma3-270m-severity/adapter --val-limit 20` (from `backend/`)

The frontend and the public API do not change. If the model fails to load (wrong path, missing packages, unavailable device), `/health` reports `unavailable` with a safe reason, and triage returns `503 provider_unavailable`. **The app never falls back to mock.** Invalid model output returns `502 invalid_model_output`, and generation errors return `500 inference_failed`. No prediction is fabricated in any of these cases.

### Prompt format (Gemma provider)

The prompt follows `scripts/train_severity_lora.py` exactly:

- A single user turn: `instruction + "\n\n" + incident_text`, with the instruction copied verbatim from `scripts/build_severity_dataset.py`.
- Rendered with the adapter's saved chat template (`add_generation_prompt=True`).
- Tokenized with `add_special_tokens=False`, because the template already emits `<bos>`.
- Greedy decoding (`do_sample=False`), `float32`, `model.eval()` and `torch.inference_mode()`.

`scripts/evaluate_severity_lora.py` differs from training in two ways: it adds an `"Incident:\n"` prefix and a second BOS token. The provider follows **training**. To switch, see `INCIDENT_PREFIX` in `gemma_prompt.py`.

The API takes structured fields, but the training inputs were single narrative paragraphs ("… Business impact: … Diagnostic evidence: … Scope check: …"). `render_incident_text()` maps the structured fields onto that layout.

## Full triage, review and routing

**Two adapters, one base model.** The base weights are loaded once; both LoRA adapters are attached and switched per request (`set_adapter`). Each full analysis makes two calls:

| Adapter | Answers | Held-out accuracy (synthetic) |
|---|---|---|
| `gemma3-270m-triage-v3` | category, root cause, proof (`evidence`), recommended actions | category 100%, root cause 100% (n=100) |
| `gemma3-270m-severity` | **severity** (shown, used for routing and evaluation) | 100% (50/50 examples, live API) |

The triage adapter's own severity (≈45% on held-out data) is returned as `triage_severity` and shown for comparison only. If the severity adapter fails, the response falls back to the triage adapter's severity and says so.

**Prompt layout matters.** `scripts/trial_form_rendering.py` measured, on 60 held-out rows: the earlier form rendering (title + service + "N affected users") cut severity accuracy to **53%**; rendering the form in the training layout (`narrative. Business impact. Diagnostic evidence. Scope check. Additional context.`) restores **100%**. The form therefore has optional *Scope check* and *Additional context* fields; when empty, the scope sentence is derived from the scope fields in the training phrasing.

**Review workflow.** Every full analysis (manual or queue) creates a review ticket automatically: *Pending review → In review → Approved / Rejected → With team*. On approval the AI category picks the owning team and the final severity picks the systems (P1: ServiceNow, Jira, Slack `#major-incidents` + team channel, Teams bridge, CRM; P2: ServiceNow, Jira, team Slack, CRM; P3: ServiceNow, Jira; P4: ServiceNow).

**Integrations run in sandbox mode.** Each connector builds the exact vendor request (Slack `chat.postMessage` Block Kit, Teams Adaptive Card, Jira REST v3, ServiceNow Table API, Salesforce Case) and records it in an in-memory outbox with a receipt. No network call is made. Going live means adding the HTTP call and credentials in `app/services/integrations/connectors.py`; the Integrations page lists the steps per vendor.

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/triage/full` | Five-field analysis + severity (and `severity_source`, `triage_severity`, proof grounding, uncertainty notes) |
| `GET /api/v1/triage/evaluation` | Offline metrics shipped with the triage adapter, or `available: false` |
| `POST /api/v1/tickets/{id}/analyze/full` | Full analysis of a queued ticket; reference labels attached after inference |
| `GET /api/v1/examples` | 50 held-out manual-triage examples (labels shown only after inference) |
| `GET /api/v1/integrations` | Connectors, team directory, severity routing rules |
| `POST /api/v1/dispatch/preview` · `POST /api/v1/dispatch` | Routing plan and vendor payloads for an approved ticket · sandbox delivery with receipts |

## Ticket queue and evaluation

The console's views are in the sidebar:

- **Home** (`/`): starting points, model status and measured accuracy.
- **Manual triage** (`/triage`): the incident form; **Load example** deals one of 50 held-out incidents, never repeating until all 50 are shown.
- **Ticket queue** (`/queue`): one of 120 held-out tickets at a time, with **Analyze** (full or severity-only) and **Next Ticket**.
- **Reviews** (`/reviews`): the human review and routing workflow.
- **Evaluation** (`/evaluation`): severity accuracy and confusion matrix for this session, plus category/root-cause accuracy for full analyses.
- **Integrations** (`/integrations`): routing rules, team directory and go-live steps per connector.

The queue and examples come only from the held-out validation and test splits (`scripts/build_demo_data.py`); neither adapter trained on them.

How the queue behaves:

- **Sequence.** Tickets are issued in file order. Within a session no ticket is issued twice. After the last ticket, **Next Ticket** shows an *End of queue* message.
- **Session lifetime.** A session lives in backend memory. It ends with **Start new session** (`POST /api/v1/tickets/reset`) or when the API restarts. Reloading the page restores the current ticket without advancing.
- **Label isolation.** The provider receives only the ticket `description`, formatted exactly like the training data: `instruction + "\n\n" + description`. The title and `expected_severity` are never sent to the model. Tickets returned before analysis don't include `expected_severity`. The backend attaches the label only after the provider has returned a prediction. Tests verify all of this, including through the real `GemmaSeverityProvider` prompt path.
- **Provider labelling.** With `INFERENCE_PROVIDER=gemma`, Analyze calls the real model, and results are tagged **MODEL PREDICTION · GEMMA** with the measured inference time. In mock mode, results carry **MOCK RESULT**, and the Evaluation view states *"this is not a model evaluation"*. Mock predictions for queued tickets come from a content-blind hash, so they can't pass for a working classifier.
- **Scoring.** Invalid model output returns `502`, is recorded in the evaluation as *invalid* (never as a prediction), and counts as incorrect. Skipped tickets are not evaluated.

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/tickets/next` | Issue the next ticket (advances the session). Returns `{ticket: null, exhausted: true, message}` after the last ticket |
| `GET /api/v1/tickets/session` | Current state without advancing: totals, current ticket, its analysis |
| `POST /api/v1/tickets/reset` | Start a new session (back to ticket 1, results cleared) |
| `POST /api/v1/tickets/{ticket_id}/analyze` | Run the configured provider on that ticket. Returns `severity`, `inference_ms`, `provider`, `is_mock`, and, after inference, `expected_severity` and `correct`. Returns `409` if the ticket wasn't issued, `404` if it's unknown |
| `GET /api/v1/tickets/evaluation` | `accuracy` (correct / analyzed), `confusion_matrix` (rows = expected; columns = predicted plus `invalid`), and per-ticket results |

An invalid or missing ticket file makes only the ticket endpoints return `503 tickets_unavailable`. The rest of the API keeps working.

**Live result with the real model** (`queue_smoke_test.py --reset`, Gemma 3 270M IT plus the severity adapter, MPS): **50/50 = 100%** and 0 invalid outputs; inference took 269 ms on average (257–493 ms). These 50 tickets are copied exactly from the held-out test split (`incident_test_v3.jsonl`), so this is a test-set result on **templated synthetic** text. It says nothing about real-world tickets: free-form input generalizes poorly (see Known limitations).

```bash
cd ~/Desktop/AI_Triage/backend && ~/AI-Lab/.venv/bin/python scripts/queue_smoke_test.py --reset
```

## Configuration reference

| Backend (`backend/.env`) | Default | Notes |
|---|---|---|
| `INFERENCE_PROVIDER` | `mock` | `mock` or `gemma`; anything else aborts startup |
| `MODEL_ID` | `google/gemma-3-270m-it` | HF model id or local path to the base model |
| `BASE_MODEL_PATH` | `models/gemma3-270m-severity/base` | local base model directory (offline); empty = download `MODEL_ID` from Hugging Face |
| `ADAPTER_PATH` | `models/gemma3-270m-severity/adapter` | absolute, or relative to `ADAPTER_BASE_DIR` / `backend/` |
| `ADAPTER_BASE_DIR` | *(empty → `backend/`)* | optional root for a relative `ADAPTER_PATH`, e.g. `/mnt/models` |
| `DEVICE` | `auto` | `auto` (cuda → mps → cpu), `cpu`, `mps`, `cuda`. An explicit device that isn't available is a load failure, not a silent switch |
| `MAX_NEW_TOKENS` | `32` | 1–256 |
| `FRONTEND_ORIGIN` | `http://localhost:3000` | comma-separated CORS origins |
| `LOG_LEVEL` | `INFO` | JSON-lines logs to stdout; incident text is never logged |
| `MOCK_LATENCY_MS` | `400` | artificial delay so loading states are visible |
| `HISTORY_SIZE` | `200` | in-memory results for `GET /api/v1/triage/{id}` (lost on restart) |
| `TICKETS_PATH` | `data/tickets.jsonl` | ticket queue JSONL; relative to `backend/` |
| `EXAMPLES_PATH` | `data/examples.jsonl` | manual-triage examples; relative to `backend/` |
| `TRIAGE_ADAPTER_PATH` | *(empty: full triage off)* | five-field adapter, e.g. `models/gemma3-270m-triage-v3/adapter` |
| `TRIAGE_PROMPT_FORMAT` | `v3` | `v3` or `incident_lora`: the layout the triage adapter was trained on |
| `TRIAGE_MAX_NEW_TOKENS` | `192` | training targets are at most 109 tokens |
| `TRIAGE_TIMEOUT_S` | `120` | generation limit; exceeding it returns `504 inference_timeout` |
| `SEVERITY_CROSS_CHECK` | `true` | run the severity adapter for every full analysis (its answer is the severity shown) |
| `EXPOSE_RAW_OUTPUT` | `false` | development only: include raw generated text in responses and invalid-output errors |

| Frontend (`frontend/.env.local`) | Default |
|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` (inlined at build time: restart dev / rebuild after changing) |

## API contract

`GET /health` → `200`
```json
{"status":"ok","api_version":"0.1.0","timestamp":"…",
 "inference":{"provider":"mock","model_id":"mock-synthetic-rules-v1","is_mock":true,
              "state":"ready","ready":true,"model_loaded":false,"device":null,"detail":"…"}}
```
`state` ∈ `not_loaded | loading | ready | unavailable`. `ready` and `model_loaded` are never true just because the API is up.

`POST /api/v1/triage` → `200`
```json
{"request_id":"…","incident_title":"…","severity":"P1","human_review_required":true,
 "provider":"mock","model_id":"mock-synthetic-rules-v1","is_mock":true,
 "inference_ms":401.3,"created_at":"2026-10-10T12:00:00Z"}
```
The request fields are `title` (3–200 chars), `description` (10–4000), `affected_service` (2–120), `affected_users` (integer 0–1,000,000), `affected_departments` and `affected_sites` (≤20 unique entries, each ≤80 chars, optional), `business_impact` (5–2000), `workaround_available` (`true` / `false` / `null` = unknown, optional) and `diagnostic_evidence` (≤4000, optional). Unknown fields are rejected.

`GET /api/v1/triage/{request_id}` returns a result from this process's in-memory history, or `404`.

Errors always use this shape: `{"error":{"code","message","request_id","details?":[{"field","message"}]}}`

| HTTP | `code` | Meaning |
|---|---|---|
| 422 | `validation_error` / `invalid_json` | bad input (field details included) |
| 503 | `provider_not_ready` | model still loading |
| 503 | `provider_unavailable` | model failed to load |
| 500 | `inference_failed` | generation raised |
| 502 | `invalid_model_output` | output was not exactly `{"severity":"P1".."P4"}` |

## Mock provider

`MockInferenceProvider` applies a fixed, transparent rule to the structured scope fields:

- **P1:** 2 or more departments, 2 or more sites, and no confirmed workaround
- **P2:** more than 1 user
- **P3:** exactly 1 user
- **P4:** 0 users

It exists only to exercise the full flow. It reads no datasets or labels, reports `model_loaded: false`, and is labelled as mock everywhere. To exercise the error and retry UI, include `[mock-fail]` in an incident title.

## Azure GPU VM portability

The backend and frontend are independent processes. Model and adapter locations come from environment variables (`MODEL_ID`, `ADAPTER_PATH`, `ADAPTER_BASE_DIR`). `DEVICE=auto` prefers CUDA. The provider interface has no device or Apple-specific assumptions. To deploy on a VM:

1. Run uvicorn on the VM with `--host 0.0.0.0`.
2. Set `FRONTEND_ORIGIN` to the dashboard's URL.
3. Build the frontend with `NEXT_PUBLIC_API_BASE_URL` pointing at the VM.

The API contract is identical between local and cloud. No Azure resources, containers or authentication are included in this phase.

## Verification status (2026-10-11)

- `pytest`: **214 passed**. `npm test`: **57 passed**; `npm run typecheck` clean. `npm run build` was not re-run for this change.
- Real model on MPS through the HTTP API: 50 manual examples → valid JSON, category, root cause and severity **50/50**; 16 queue tickets in full mode → category, root cause, severity **16/16**, 0 invalid outputs.
- Routing: a P1 approval produced 6 sandbox deliveries (ServiceNow, Jira, Slack ×2, Teams, CRM) with receipts.
- The UI was checked through tests and served routes (all 200); it was not inspected in a browser by the automated checks.

## Verification status (2026-10-10, severity-only release)

**Backend:**
- `pytest`: **140 passed** (includes download-script and missing-weights tests).
- `scripts/smoke_test.py` passed against the live API.
- `scripts/queue_smoke_test.py --reset` passed against the live API with the real Gemma model on MPS.

**Frontend:**
- `npm run typecheck`: clean.
- `npm test`: **45 passed**.
- `npm run build`: succeeds, with routes `/`, `/queue` and `/evaluation`.

**Browser (real Gemma on MPS):**
- The queue shows one ticket at a time and **Analyze** returns real predictions with their inference time.
- **Next Ticket** advanced through all 50 tickets with no repeats, then showed *End of queue*.
- Reloading the page restores the current ticket without advancing.
- The Evaluation view shows accuracy, the confusion matrix and per-ticket rows.

**Browser (mock mode):** the header pill, banner, result label and Evaluation warning all say mock, and no "model prediction" tag appears.

## Known limitations

- **Synthetic data.** All accuracy figures come from templated synthetic tickets. The form-rendering fix restored 100% on held-out examples, but hand-written, free-form incidents remain out of distribution (e.g. the triage adapter can return a category outside the taxonomy, which is rejected as `invalid_model_output`). Real-world accuracy needs an evaluation on labelled real tickets.
- **Integrations are sandboxed.** Connectors build real vendor payloads but do not send them; receipts are sandbox references.
- **Review tickets live in the browser tab** (lost on reload); the dispatch outbox lives in backend memory.
- Results history lives in process memory: it is per-process and lost on restart. There is no database or authentication by design.
- Generation is serialized with a lock, so one request is processed at a time per process.
