# User Guide: Running and Using AI Incident Triage

This guide takes you from a fresh download of the repository to a working dashboard
that classifies IT incidents with the project's fine-tuned Gemma model.

- **Time needed:** about 15 minutes. Most of it is installing packages and downloading the 511 MB model.
- **Background:** you don't need any machine-learning knowledge.

---

## 1. What you get

A web app with three screens:

| Screen | What it does |
|---|---|
| **Ticket queue** | Shows IT tickets one at a time. Click **Analyze** and the model predicts a severity (P1–P4) |
| **Evaluation** | Compares the model's predictions with the correct answers: accuracy and a confusion matrix |
| **Manual triage** | Type in your own incident and get a severity suggestion |

Severity levels:

| Level | Meaning |
|---|---|
| **P1 — Critical** | A business-critical service is down across multiple departments and at least two sites, with no workaround |
| **P2 — High** | Multiple users in one department are blocked; other departments still work |
| **P3 — Medium** | One user or one device is affected; everyone else works normally |
| **P4 — Low** | No real service interruption; a minor issue or a request |

The app runs on your own computer. The two parts talk to each other locally:

```
Browser  ──►  Frontend (Next.js, port 3000)  ──►  Backend (FastAPI, port 8000)  ──►  Gemma model
```

No incident data leaves your machine.

---

## 2. Requirements

| | Minimum | Notes |
|---|---|---|
| OS | macOS, Linux or Windows | Commands below are for macOS/Linux; see the [Windows notes](#windows-notes) |
| Python | **3.11** | Check with `python3.11 --version` |
| Node.js | **20.19+** or 22 LTS | Check with `node --version` |
| Git | any | Check with `git --version` |
| RAM | 8 GB | The model uses about 1.1 GB while running |
| Disk | about 3 GB free | Python packages (mostly PyTorch), Node packages, 511 MB model |
| GPU | optional | Apple Silicon (MPS) and NVIDIA (CUDA) are used automatically; CPU works too (about 0.4 s per ticket) |
| Accounts | **none** | No Hugging Face or cloud account needed |

---

## 3. Install (one time)

### 3.1 Download the project

```bash
git clone https://github.com/Atifelx/AI_Triage.git
cd AI_Triage
```

### 3.2 Backend: Python packages

```bash
cd backend
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements-gemma.txt
```

This installs FastAPI plus PyTorch, Transformers and PEFT. PyTorch is about 1 GB, so this step takes a few minutes.

> To try the dashboard without the AI model, `pip install -r requirements.txt` is enough. Then keep `INFERENCE_PROVIDER=mock` in step 3.4.

### 3.3 Backend: download the model

```bash
python scripts/download_model.py
```

Expected output:

```
Gemma base weights are subject to the Gemma Terms of Use: https://ai.google.dev/gemma/terms
Downloading from hf-mirror …
OK: installed base/model.safetensors (sha256 verified) from hf-mirror.
```

What happens:

- The repository already contains the project's **fine-tuned adapter** (the part trained for this task).
- This step downloads the large **base model** it was built on, Google's Gemma 3 270M (511 MB), from a public mirror.
- The file is installed **only if its SHA-256 fingerprint matches** the one recorded in the repo. A corrupted or different file is rejected, so you always run exactly the model that was trained and tested.

Other sources, if the default doesn't work for you:

```bash
python scripts/download_model.py --source hf-official
```

This downloads from Google's official repo. It needs a Hugging Face account, the Gemma license accepted on huggingface.co, and `export HF_TOKEN=...` set first.

```bash
MODEL_WEIGHTS_URL="https://..." python scripts/download_model.py --source azure
```

This downloads from your own copy, e.g. Azure Blob Storage.

### 3.4 Backend: settings

```bash
cp .env.example .env
```

Open `backend/.env` and change one line:

```
INFERENCE_PROVIDER=gemma
```

| Setting | Use |
|---|---|
| `INFERENCE_PROVIDER=gemma` | Real predictions from the fine-tuned model |
| `INFERENCE_PROVIDER=mock` | Fake, clearly labelled results. Useful for testing the UI without the model |

All other defaults work as they are. See the README's *Configuration reference* for every option.

### 3.5 Frontend: Node packages

In a new terminal, from the `AI_Triage` folder:

```bash
cd frontend
npm install
cp .env.local.example .env.local
```

---

## 4. Start the app (every time)

You need **two terminals**, one per part.

**Terminal 1: backend**

```bash
cd AI_Triage/backend
source .venv/bin/activate
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Wait for these lines:

```
INFO:     Uvicorn running on http://127.0.0.1:8000
... "msg": "Gemma provider ready", ... "device": "mps", "load_seconds": 6.6
```

The device shows `mps` (Mac), `cuda` (NVIDIA) or `cpu`.

**Terminal 2: frontend**

```bash
cd AI_Triage/frontend
npm run dev
```

Then open **http://localhost:3000** in your browser.

To stop the app, press `Ctrl+C` in each terminal.

### Check it's working

The header at the top right shows three status pills:

| Pill | Should show | Meaning |
|---|---|---|
| API | 🟢 **Online** | The backend is reachable |
| Provider | **Gemma** | The real model is configured (it shows **Mock** in mock mode) |
| Model | 🟢 **Ready** | The model is loaded and can answer. It shows **Loading…** for the first few seconds after start |

The model ID and device appear under the pills, e.g. `google/gemma-3-270m-it + LoRA:gemma3-270m-severity · device: mps`.

---

## 5. Using the app

### 5.1 Ticket queue (start here)

1. Click **Ticket queue** in the header.
2. You see **Ticket 1 of 50**, with its ID and full description.
3. Click **Analyze**. Within about a second, the right-hand panel shows:
   - **Predicted severity**, e.g. **P2 — High**, tagged **MODEL PREDICTION · GEMMA**.
   - **Inference time**, e.g. `382 ms`: how long the model took.
   - **Post-inference evaluation**: the ticket's correct answer and **✓ Match** or **✗ Mismatch**.
4. Click **Next Ticket** to continue. Tickets never repeat within a session.
5. After ticket 50, **Next Ticket** shows **End of queue**. From there you can open the evaluation or click **Start new session** to begin again.

Things to know:

- **The model never sees the correct answer.** It receives only the ticket description. The correct answer is attached *after* the model has responded, purely for scoring.
- **Skipping is allowed.** Clicking **Next Ticket** without **Analyze** skips a ticket; skipped tickets aren't scored.
- **Your place is saved.** Reloading the page keeps your position. The session lasts until the backend is restarted or you start a new session.

### 5.2 Evaluation

Click **Evaluation** to see how the model did on the tickets you analyzed:

- **Tiles:** Accuracy, Analyzed, Correct, Invalid outputs, and mean inference time.
- **Confusion matrix:** rows are the correct severity and columns are the predicted severity. Outlined cells on the diagonal are correct predictions. Darker cells hold more tickets.
- **Predicted vs expected table:** one row per analyzed ticket.

If the backend runs in **mock** mode, this page shows **"MOCK PROVIDER — this is not a model evaluation"**, because mock results are random-like placeholders.

### 5.3 Manual triage

Fill in the form (title, description, affected service, users, departments, sites, business impact, workaround, evidence) and click **Analyze incident**. **Load sample incident** fills the form with examples.

> ⚠️ **Treat manual-triage results with caution.** The model was trained on tickets written in one specific template; the queue tickets use that template. Free-form text typed into this form is often classified wrongly (see `docs/MODEL_DEVELOPMENT.md`, section 8). The queue is the reliable way to judge the model.

Every result says **Human review required**. The model only suggests a severity; it doesn't diagnose or fix anything.

---

## 6. Troubleshooting

| What you see | Cause | Fix |
|---|---|---|
| Red banner **Backend unavailable** | Backend not running, or on another port | Start terminal 1 (section 4), then click **Retry connection** |
| Model pill **Unavailable**: *"Base model weights are not downloaded yet"* | Step 3.3 was skipped | `cd backend && python scripts/download_model.py`, then restart the backend |
| Model pill **Unavailable**: other reason | Packages missing, or a wrong path in `.env` | Read the backend terminal's error, check `pip install -r requirements-gemma.txt`, and compare `.env` with `.env.example` |
| Model pill **Loading…** for a long time | The first load on a slow disk or CPU | Wait 10–30 s; the page updates by itself |
| Provider pill **Mock** but you want the real model | `.env` still has the default | Set `INFERENCE_PROVIDER=gemma` and restart the backend |
| `download_model.py`: *checksum mismatch* | A corrupted or different file was downloaded | Run it again; the bad file was discarded. Try `--source hf-official` |
| `download_model.py`: *HTTP 401/403* on `hf-official` | Gemma license not accepted, or `HF_TOKEN` missing | Accept the license on huggingface.co/google/gemma-3-270m-it and set `HF_TOKEN`, or use the default source |
| `Address already in use` | Port 8000 or 3000 is taken | Stop the other program, or use `--port 8001` and set `NEXT_PUBLIC_API_BASE_URL=http://localhost:8001` in `frontend/.env.local` |
| Browser console shows a *CORS* error | The frontend runs on a different address than allowed | Add its address to `FRONTEND_ORIGIN` in `backend/.env`, comma-separated |
| **End of queue** | All 50 tickets issued | Click **Start new session** |
| `npm WARN EBADENGINE` | Node.js older than 20.19 | Usually harmless; upgrade to Node 22 LTS to remove it |

**Checking the backend directly.** Open http://localhost:8000/health in the browser. With the model ready you'll see `"provider":"gemma"`, `"ready":true` and `"model_loaded":true`. Interactive API docs are at http://localhost:8000/docs.

**Verifying the installed model** at any time:

```bash
cd backend/models/gemma3-270m-severity && shasum -a 256 -c SHA256SUMS
```

---

## 7. Optional checks

From `backend/`, with the virtual environment active:

```bash
pytest
```

This runs 140 automated backend tests and doesn't need the model.

```bash
python scripts/smoke_test.py --wait 120
```

This sends a live request to the running backend.

```bash
python scripts/queue_smoke_test.py --reset
```

This runs all 50 tickets through the running backend and prints accuracy and the confusion matrix. It **resets** the queue session.

From `frontend/`:

```bash
npm test && npm run build
```

---

## Windows notes (not tested on Windows)

Use PowerShell. These steps differ from the macOS/Linux commands:

| Step | Windows command |
|---|---|
| Create the environment (3.2) | `py -3.11 -m venv .venv` |
| Activate it (3.2, 4) | `.venv\Scripts\Activate.ps1` |
| Copy files (3.4, 3.5) | `copy .env.example .env` and `copy .env.local.example .env.local` |
| Verify the model | `Get-FileHash models\gemma3-270m-severity\base\model.safetensors -Algorithm SHA256`, then compare with `SHA256SUMS` |

## License

The model is subject to the [Gemma Terms of Use](https://ai.google.dev/gemma/terms) and the
[Gemma Prohibited Use Policy](https://ai.google.dev/gemma/prohibited_use_policy); see
`backend/models/gemma3-270m-severity/NOTICE`. The data is synthetic, and every result needs human review.
