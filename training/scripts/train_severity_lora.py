import json
import random
from pathlib import Path

import torch
from transformers import AutoTokenizer, AutoModelForCausalLM
from peft import LoraConfig, get_peft_model

ROOT = Path(__file__).resolve().parents[1]
MODEL_ID = "google/gemma-3-270m-it"
OUT = ROOT / "outputs/gemma3-270m-severity-lora"
MAX_LENGTH = 384
EPOCHS = 5
LR = 5e-5
SEED = 42

random.seed(SEED)
torch.manual_seed(SEED)

def read_jsonl(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]

def prepare(rows, tokenizer):
    result = []
    for row in rows:
        messages = [
            {"role": "user", "content": row["instruction"] + "\n\n" + row["input"]},
            {"role": "assistant", "content": row["output"]},
        ]
        prompt_messages = messages[:1]
        full_text = tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=False
        )
        prompt_text = tokenizer.apply_chat_template(
            prompt_messages, tokenize=False, add_generation_prompt=True
        )
        ids = tokenizer(full_text, add_special_tokens=False)["input_ids"]
        prompt_ids = tokenizer(prompt_text, add_special_tokens=False)["input_ids"]
        if len(ids) > MAX_LENGTH:
            raise ValueError(f"{row['id']} exceeds MAX_LENGTH={MAX_LENGTH}")
        labels = ids.copy()
        labels[:len(prompt_ids)] = [-100] * len(prompt_ids)
        if all(x == -100 for x in labels):
            raise ValueError(f"No response tokens to train on: {row['id']}")
        result.append((ids, labels))
    return result

def main():
    train_path = ROOT / "data/severity_train_v1.jsonl"
    val_path = ROOT / "data/severity_val_v1.jsonl"
    train_rows, val_rows = read_jsonl(train_path), read_jsonl(val_path)

    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
    train_data = prepare(train_rows, tokenizer)
    val_data = prepare(val_rows, tokenizer)

    device = "mps" if torch.backends.mps.is_available() else "cpu"
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_ID, torch_dtype=torch.float32
    ).to(device)

    model = get_peft_model(
        model,
        LoraConfig(
            r=8, lora_alpha=16, lora_dropout=0.05,
            target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
            bias="none", task_type="CAUSAL_LM",
        ),
    )
    model.print_trainable_parameters()
    optimizer = torch.optim.AdamW(
        [p for p in model.parameters() if p.requires_grad], lr=LR
    )

    OUT.mkdir(parents=True, exist_ok=True)
    best_val_loss = float("inf")
    best_dir = OUT / "best_adapter"

    for epoch in range(EPOCHS):
        model.train()
        random.shuffle(train_data)
        total_loss = 0.0

        for i, (ids, labels) in enumerate(train_data):
            x = torch.tensor([ids], dtype=torch.long, device=device)
            y = torch.tensor([labels], dtype=torch.long, device=device)
            mask = torch.ones_like(x)
            loss = model(input_ids=x, attention_mask=mask, labels=y).loss
            loss.backward()

            if (i + 1) % 4 == 0 or i + 1 == len(train_data):
                optimizer.step()
                optimizer.zero_grad(set_to_none=True)

            total_loss += loss.detach().item()

            if (i + 1) % 80 == 0:
                print(f"Epoch {epoch+1}/{EPOCHS} step {i+1}/{len(train_data)} "
                      f"train_loss={total_loss/(i+1):.4f}", flush=True)

        model.eval()
        val_loss = 0.0
        with torch.no_grad():
            for ids, labels in val_data:
                x = torch.tensor([ids], dtype=torch.long, device=device)
                y = torch.tensor([labels], dtype=torch.long, device=device)
                val_loss += model(
                    input_ids=x, attention_mask=torch.ones_like(x), labels=y
                ).loss.item()

        val_loss /= len(val_data)
        train_loss = total_loss / len(train_data)
        print(f"Epoch {epoch+1}: train_loss={train_loss:.4f} "
              f"val_loss={val_loss:.4f}", flush=True)

        if val_loss < best_val_loss:
            best_val_loss = val_loss
            model.save_pretrained(best_dir)
            tokenizer.save_pretrained(best_dir)
            print(f"Saved best adapter to {best_dir}", flush=True)

    print("Training complete. Best validation loss:", best_val_loss)

if __name__ == "__main__":
    main()
