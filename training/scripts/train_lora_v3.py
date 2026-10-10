#!/usr/bin/env python3
"""LoRA fine-tuning for Gemma 3 270M on incident dataset v3."""

import json
import random
from pathlib import Path

import torch
from peft import LoraConfig, get_peft_model
from transformers import AutoModelForCausalLM, AutoTokenizer

ROOT = Path(__file__).resolve().parent.parent
TRAIN_FILE = ROOT / "data" / "incident_train_v3.jsonl"
OUTPUT_DIR = ROOT / "outputs" / "gemma3-270m-lora-v3"

MODEL_ID = "google/gemma-3-270m-it"
SEED = 42
EPOCHS = 3
LEARNING_RATE = 1e-4
MAX_LENGTH = 768
GRAD_ACCUM_STEPS = 4


def read_jsonl(path):
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def main():
    random.seed(SEED)
    torch.manual_seed(SEED)

    if not TRAIN_FILE.exists():
        raise SystemExit(f"Training file not found: {TRAIN_FILE}")

    rows = read_jsonl(TRAIN_FILE)
    if len(rows) != 800:
        raise SystemExit(f"Expected 800 training rows; found {len(rows)}")

    required = {"instruction", "input", "output"}
    for i, row in enumerate(rows):
        missing = required - row.keys()
        if missing:
            raise SystemExit(f"Row {i} is missing fields: {sorted(missing)}")
        try:
            target = json.loads(row["output"])
        except (TypeError, json.JSONDecodeError) as exc:
            raise SystemExit(f"Invalid output JSON in row {i}: {exc}")
        expected = {
            "category", "severity", "root_cause", "evidence",
            "recommended_actions", "human_review_required",
        }
        if set(target) != expected:
            raise SystemExit(
                f"Unexpected output keys in row {i}: {sorted(target)}"
            )

    print(f"Dataset: {TRAIN_FILE}")
    print(f"Training examples: {len(rows)}")
    print("Loading tokenizer and preparing examples...")

    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
    examples = []
    lengths = []

    for row in rows:
        prompt = row["instruction"] + "\n\nIncident:\n" + row["input"]
        answer = row["output"]

        prompt_text = tokenizer.apply_chat_template(
            [{"role": "user", "content": prompt}],
            tokenize=False,
            add_generation_prompt=True,
        )
        full_text = tokenizer.apply_chat_template(
            [
                {"role": "user", "content": prompt},
                {"role": "assistant", "content": answer},
            ],
            tokenize=False,
            add_generation_prompt=False,
        )

        prompt_ids = tokenizer(
            prompt_text, add_special_tokens=False
        )["input_ids"]
        full_ids = tokenizer(
            full_text, add_special_tokens=False
        )["input_ids"]

        lengths.append(len(full_ids))
        if len(full_ids) > MAX_LENGTH:
            raise SystemExit(
                f"Sequence too long ({len(full_ids)} tokens; limit "
                f"{MAX_LENGTH}) for incident {row.get('id', '?')}. "
                "No training started. Increase MAX_LENGTH after checking "
                "memory requirements."
            )

        labels = full_ids.copy()
        prefix_len = len(prompt_ids)
        if prefix_len >= len(labels):
            raise SystemExit(
                f"No answer tokens found for incident {row.get('id', '?')}"
            )
        labels[:prefix_len] = [-100] * prefix_len
        examples.append((full_ids, labels))

    print(f"Prepared: {len(examples)} / {len(rows)} examples")
    print(f"Longest sequence: {max(lengths)} tokens")
    print(f"Max sequence length: {MAX_LENGTH}")

    device = torch.device(
        "mps" if torch.backends.mps.is_available() else "cpu"
    )
    print(f"Device: {device}")
    print(f"Loading model: {MODEL_ID}")

    model = AutoModelForCausalLM.from_pretrained(
        MODEL_ID, dtype=torch.float32
    )
    model.to(device)

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
    model.print_trainable_parameters()
    model.train()

    optimizer = torch.optim.AdamW(
        [p for p in model.parameters() if p.requires_grad],
        lr=LEARNING_RATE,
    )
    optimizer.zero_grad(set_to_none=True)

    for epoch in range(EPOCHS):
        random.shuffle(examples)
        total_loss = 0.0

        for idx, (input_ids, labels) in enumerate(examples, start=1):
            input_tensor = torch.tensor(
                [input_ids], dtype=torch.long, device=device
            )
            label_tensor = torch.tensor(
                [labels], dtype=torch.long, device=device
            )
            attention_mask = torch.ones_like(input_tensor)

            output = model(
                input_ids=input_tensor,
                attention_mask=attention_mask,
                labels=label_tensor,
            )
            loss = output.loss
            (loss / GRAD_ACCUM_STEPS).backward()
            total_loss += loss.detach().item()

            if idx % GRAD_ACCUM_STEPS == 0:
                torch.nn.utils.clip_grad_norm_(
                    [p for p in model.parameters() if p.requires_grad],
                    max_norm=1.0,
                )
                optimizer.step()
                optimizer.zero_grad(set_to_none=True)

            if idx % 100 == 0 or idx == len(examples):
                print(
                    f"Epoch {epoch + 1}/{EPOCHS} | "
                    f"{idx}/{len(examples)} | "
                    f"mean loss {total_loss / idx:.4f}"
                )

        # 800 examples is divisible by GRAD_ACCUM_STEPS, so no
        # leftover accumulated gradients should remain.
        print(
            f"Epoch {epoch + 1} mean loss: "
            f"{total_loss / len(examples):.4f}"
        )

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(OUTPUT_DIR)
    tokenizer.save_pretrained(OUTPUT_DIR)

    print(f"\nAdapter saved to: {OUTPUT_DIR}")
    print("Training complete. Evaluate on v3 validation data next.")


if __name__ == "__main__":
    main()
