#!/usr/bin/env python3
"""Download the Gemma base-model weights that the severity adapter was trained on.

The git repository ships the fine-tuned LoRA adapter and the base model's small
config files. Only the 511 MB weights file is fetched here, and it is installed
only if its SHA-256 matches the value in models/gemma3-270m-severity/SHA256SUMS,
so every installation runs exactly the model that was trained and evaluated.

Standard library only: run it before `pip install`.

    python scripts/download_model.py                      # auto: azure (if configured) -> hf-mirror -> hf-official
    python scripts/download_model.py --source hf-official # Google's gated repo; needs HF_TOKEN + accepted license
    MODEL_WEIGHTS_URL="https://<acct>.blob.core.windows.net/models/model.safetensors?<sas>" \\
        python scripts/download_model.py --source azure   # your own Azure Blob copy

Sources (all pinned to exact revisions, all checksum-verified):
  azure        MODEL_WEIGHTS_URL / --url: any HTTPS URL, e.g. an Azure Blob SAS URL
  hf-mirror    unsloth/gemma-3-270m-it: public, no account; weights byte-identical to Google's
  hf-official  google/gemma-3-270m-it: gated; needs HF_TOKEN and the Gemma license accepted on huggingface.co

The model is subject to the Gemma Terms of Use (see models/gemma3-270m-severity/NOTICE).
"""

from __future__ import annotations

import argparse
import hashlib
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
MODEL_DIR = BACKEND_DIR / "models" / "gemma3-270m-severity"
WEIGHTS_REL = "base/model.safetensors"

SOURCES = {
    # Revisions are pinned: a repo update upstream can never change what gets installed.
    "hf-mirror": "https://huggingface.co/unsloth/gemma-3-270m-it/resolve/"
                 "23cf460f6bb16954176b3ddcc8d4f250501458a9/model.safetensors",
    "hf-official": "https://huggingface.co/google/gemma-3-270m-it/resolve/"
                   "ac82b4e820549b854eebf28ce6dedaf9fdfa17b3/model.safetensors",
}
CHUNK = 1024 * 1024


class DownloadError(Exception):
    pass


def expected_sha256(sums_file: Path, rel_path: str) -> str:
    for line in sums_file.read_text().splitlines():
        parts = line.split()
        if len(parts) == 2 and parts[1].lstrip("*") == rel_path:
            return parts[0].lower()
    raise DownloadError(f"{rel_path} is not listed in {sums_file}")


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def download(url: str, dest: Path, sha256: str, headers: dict[str, str] | None = None,
             quiet: bool = False) -> None:
    """Stream url -> dest, verifying SHA-256. dest is only created if the hash matches."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": "ai-triage-model-download", **(headers or {})})
    digest = hashlib.sha256()
    received = 0
    started = time.monotonic()
    try:
        with urllib.request.urlopen(request, timeout=60) as response, part.open("wb") as out:
            total = int(response.headers.get("Content-Length") or 0)
            while chunk := response.read(CHUNK):
                out.write(chunk)
                digest.update(chunk)
                received += len(chunk)
                if not quiet and total:
                    pct = received * 100 // total
                    rate = received / max(time.monotonic() - started, 1e-6) / 1e6
                    print(f"\r  {received / 1e6:7.1f} / {total / 1e6:.1f} MB  {pct:3d}%  {rate:5.1f} MB/s", end="", flush=True)
    except urllib.error.HTTPError as exc:
        part.unlink(missing_ok=True)
        hint = " (gated: set HF_TOKEN and accept the Gemma license on huggingface.co)" if exc.code in (401, 403) else ""
        raise DownloadError(f"HTTP {exc.code} from source{hint}") from exc
    except (urllib.error.URLError, OSError) as exc:
        part.unlink(missing_ok=True)
        raise DownloadError(f"download failed: {exc}") from exc
    if not quiet:
        print()
    got = digest.hexdigest()
    if got != sha256:
        part.unlink(missing_ok=True)
        raise DownloadError(f"checksum mismatch (expected {sha256}, got {got}); file discarded")
    part.replace(dest)


def candidate_sources(choice: str, url: str | None, token: str | None) -> list[tuple[str, str, dict[str, str]]]:
    auth = {"Authorization": f"Bearer {token}"} if token else {}
    if choice == "azure":
        if not url:
            raise DownloadError("--source azure needs --url or MODEL_WEIGHTS_URL")
        return [("azure", url, {})]
    if choice == "hf-mirror":
        return [("hf-mirror", SOURCES["hf-mirror"], {})]
    if choice == "hf-official":
        return [("hf-official", SOURCES["hf-official"], auth)]
    # auto
    plan = [("azure", url, {})] if url else []
    plan.append(("hf-mirror", SOURCES["hf-mirror"], {}))
    if token:
        plan.append(("hf-official", SOURCES["hf-official"], auth))
    return plan


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--source", choices=["auto", "azure", "hf-mirror", "hf-official"], default="auto")
    parser.add_argument("--url", default=os.getenv("MODEL_WEIGHTS_URL"), help="direct URL (e.g. Azure Blob SAS)")
    parser.add_argument("--model-dir", type=Path, default=MODEL_DIR)
    parser.add_argument("--force", action="store_true", help="re-download even if a verified file exists")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args(argv)

    sums = args.model_dir / "SHA256SUMS"
    dest = args.model_dir / WEIGHTS_REL
    try:
        sha256 = expected_sha256(sums, WEIGHTS_REL)
    except (OSError, DownloadError) as exc:
        print(f"ERROR: {exc}")
        return 2

    if dest.is_file() and not args.force:
        print(f"Found existing {WEIGHTS_REL}; verifying checksum…")
        if sha256_of(dest) == sha256:
            print("OK: weights already installed and verified.")
            return 0
        print("Existing file does not match the expected checksum; downloading a fresh copy.")

    token = os.getenv("HF_TOKEN") or os.getenv("HUGGING_FACE_HUB_TOKEN")
    try:
        plan = candidate_sources(args.source, args.url, token)
    except DownloadError as exc:
        print(f"ERROR: {exc}")
        return 2

    print("Gemma base weights are subject to the Gemma Terms of Use: https://ai.google.dev/gemma/terms")
    for name, url, headers in plan:
        print(f"Downloading from {name} …")
        try:
            download(url, dest, sha256, headers, quiet=args.quiet)
        except DownloadError as exc:
            print(f"  {name}: {exc}")
            continue
        print(f"OK: installed {WEIGHTS_REL} (sha256 verified) from {name}.")
        return 0
    print("ERROR: no source succeeded. See backend/models/gemma3-270m-severity/README.md for alternatives.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
