import json
import random
from pathlib import Path

import torch
from peft import LoraConfig, get_peft_model, PeftModel
from transformers import AutoModelForCausalLM, AutoTokenizer

ROOT = Path(__file__).resolve().parent.parent
TRAIN = ROOT / "data/incident_train_v3.jsonl"
OUT = ROOT / "outputs/gemma3-270m-lora-resumable"
STATE = OUT / "training_state.json"
OPT = OUT / "optimizer.pt"

MODEL_ID = "google/gemma-3-270m-it"
EPOCHS = 3
MAX_LENGTH = 384
ACCUM = 4
LR = 1e-4
SEED = 42


def save_checkpoint(model, optimizer, epoch, next_idx, order):
    OUT.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(OUT)
    torch.save(
        {
            "optimizer": optimizer.state_dict(),
            "epoch": epoch,
            "next_idx": next_idx,
            "order": order,
            "python_rng": random.getstate(),
            "torch_rng": torch.get_rng_state(),
        },
        OPT,
    )
    STATE.write_text(
        json.dumps({"epoch": epoch, "next_idx": next_idx}),
        encoding="utf-8",
    )
    print(f"Checkpoint saved: epoch {epoch + 1}, next example {next_idx + 1}")


def main():
    random.seed(SEED)
    torch.manual_seed(SEED)

    rows = [
        json.loads(line)
        for line in TRAIN.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if len(rows) != 800:
        raise SystemExit(f"Expected 800 rows, found {len(rows)}")

    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
    examples = []

    print("Tokenizing all 800 examples...")
    for row in rows:
        prompt = row["instruction"] + "\n\nIncident:\n" + row["input"]
        messages = [
            {"role": "user", "content": prompt},
            {"role": "assistant", "content": row["output"]},
        ]
        full = tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=False
        )
        prompt_text = tokenizer.apply_chat_template(
            [{"role": "user", "content": prompt}],
            tokenize=False, add_generation_prompt=True
        )
        ids = tokenizer(full, add_special_tokens=False)["input_ids"]
        pids = tokenizer(prompt_text, add_special_tokens=False)["input_ids"]

        if len(ids) > MAX_LENGTH:
            raise SystemExit(
                f"{row['id']} exceeds {MAX_LENGTH} tokens; no training started."
            )
        labels = ids.copy()
        labels[:len(pids)] = [-100] * len(pids)
        examples.append((ids, labels))

    device = torch.device(
        "mps" if torch.backends.mps.is_available() else "cpu"
    )
    print(f"Device: {device}; examples: {len(examples)}")

    if OPT.exists() and STATE.exists():
        print("Resuming from checkpoint...")
        model = AutoModelForCausalLM.from_pretrained(
            MODEL_ID, dtype=torch.float32
        )
        model = PeftModel.from_pretrained(model, OUT, is_trainable=True)
    else:
        print("Starting new training run...")
        model = AutoModelForCausalLM.from_pretrained(
            MODEL_ID, dtype=torch.float32
        )
        model = get_peft_model(
            model,
            LoraConfig(
                r=8,
                lora_alpha=16,
                lora_dropout=0.05,
                target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
                bias="none",
                task_type="CAUSAL_LM",
            ),
        )

    model.to(device)
    model.print_trainable_parameters()
    model.train()

    optimizer = torch.optim.AdamW(
        [p for p in model.parameters() if p.requires_grad], lr=LR
    )

    start_epoch, start_idx = 0, 0
    order = list(range(len(examples)))

    if OPT.exists() and STATE.exists():
        ckpt = torch.load(OPT, map_location="cpu", weights_only=False)
        optimizer.load_state_dict(ckpt["optimizer"])
        start_epoch = ckpt["epoch"]
        start_idx = ckpt["next_idx"]
        order = ckpt["order"]
        random.setstate(ckpt["python_rng"])
        torch.set_rng_state(ckpt["torch_rng"])
        if start_idx >= len(examples):
            start_epoch += 1
            start_idx = 0

    for epoch in range(start_epoch, EPOCHS):
        if epoch != start_epoch or start_idx == 0:
            order = list(range(len(examples)))
            random.shuffle(order)

        optimizer.zero_grad(set_to_none=True)
        total_loss, seen = 0.0, 0

        for pos in range(start_idx, len(order)):
            ids, labels = examples[order[pos]]
            x = torch.tensor([ids], dtype=torch.long, device=device)
            y = torch.tensor([labels], dtype=torch.long, device=device)
            mask = torch.ones_like(x)

            loss = model(
                input_ids=x, attention_mask=mask, labels=y
            ).loss
            (loss / ACCUM).backward()
            total_loss += loss.detach().item()
            seen += 1

            if (pos + 1) % ACCUM == 0 or pos + 1 == len(order):
                torch.nn.utils.clip_grad_norm_(
                    [p for p in model.parameters() if p.requires_grad], 1.0
                )
                optimizer.step()
                optimizer.zero_grad(set_to_none=True)

            if (pos + 1) % 100 == 0:
                print(
                    f"Epoch {epoch + 1}/{EPOCHS} | "
                    f"{pos + 1}/{len(order)} | "
                    f"loss {total_loss / seen:.4f}",
                    flush=True,
                )
                save_checkpoint(model, optimizer, epoch, pos + 1, order)

        save_checkpoint(model, optimizer, epoch + 1, 0, order)
        print(
            f"Epoch {epoch + 1} finished. "
            f"Mean loss for this run segment: {total_loss / max(seen, 1):.4f}",
            flush=True,
        )
        start_idx = 0

    print(f"Training complete. Adapter: {OUT}", flush=True)


if __name__ == "__main__":
    main()
