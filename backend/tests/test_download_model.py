"""scripts/download_model.py: checksum-gated install (uses file:// URLs, no network)."""

from __future__ import annotations

import hashlib
import importlib.util
from pathlib import Path

import pytest

from app.core.config import BACKEND_DIR

_spec = importlib.util.spec_from_file_location("download_model", BACKEND_DIR / "scripts" / "download_model.py")
dm = importlib.util.module_from_spec(_spec)
assert _spec.loader
_spec.loader.exec_module(dm)

PAYLOAD = b"fake safetensors bytes" * 1000
PAYLOAD_SHA = hashlib.sha256(PAYLOAD).hexdigest()


def _model_dir(tmp_path: Path, sha: str = PAYLOAD_SHA) -> Path:
    model = tmp_path / "model"
    (model / "base").mkdir(parents=True)
    (model / "SHA256SUMS").write_text(f"{sha}  base/model.safetensors\n{'0' * 64}  adapter/x\n")
    return model


def _source(tmp_path: Path, data: bytes = PAYLOAD) -> str:
    src = tmp_path / "remote.safetensors"
    src.write_bytes(data)
    return src.as_uri()


def test_installs_verified_file(tmp_path):
    model = _model_dir(tmp_path)
    rc = dm.main(["--source", "azure", "--url", _source(tmp_path), "--model-dir", str(model), "--quiet"])
    assert rc == 0
    assert (model / "base/model.safetensors").read_bytes() == PAYLOAD
    assert not (model / "base/model.safetensors.part").exists()


def test_rejects_checksum_mismatch_and_leaves_nothing(tmp_path):
    model = _model_dir(tmp_path)
    rc = dm.main(["--source", "azure", "--url", _source(tmp_path, b"tampered"), "--model-dir", str(model), "--quiet"])
    assert rc == 1
    assert not (model / "base/model.safetensors").exists()
    assert not (model / "base/model.safetensors.part").exists()


def test_existing_verified_file_is_not_redownloaded(tmp_path):
    model = _model_dir(tmp_path)
    (model / "base/model.safetensors").write_bytes(PAYLOAD)
    rc = dm.main(["--source", "azure", "--url", "file:///does/not/exist", "--model-dir", str(model), "--quiet"])
    assert rc == 0


def test_corrupt_existing_file_is_replaced(tmp_path):
    model = _model_dir(tmp_path)
    (model / "base/model.safetensors").write_bytes(b"corrupt")
    rc = dm.main(["--source", "azure", "--url", _source(tmp_path), "--model-dir", str(model), "--quiet"])
    assert rc == 0
    assert (model / "base/model.safetensors").read_bytes() == PAYLOAD


def test_auto_falls_through_failed_sources(tmp_path, monkeypatch):
    model = _model_dir(tmp_path)
    good = _source(tmp_path)
    monkeypatch.setitem(dm.SOURCES, "hf-mirror", good)
    rc = dm.main(["--url", "file:///missing/azure-copy", "--model-dir", str(model), "--quiet"])
    assert rc == 0
    assert (model / "base/model.safetensors").read_bytes() == PAYLOAD


def test_auto_plan_order_and_token_use():
    plan = dm.candidate_sources("auto", "https://blob/x", "tok")
    assert [p[0] for p in plan] == ["azure", "hf-mirror", "hf-official"]
    assert plan[2][2] == {"Authorization": "Bearer tok"}
    assert [p[0] for p in dm.candidate_sources("auto", None, None)] == ["hf-mirror"]
    with pytest.raises(dm.DownloadError):
        dm.candidate_sources("azure", None, None)


def test_sources_are_pinned_revisions():
    for url in dm.SOURCES.values():
        assert "/resolve/main/" not in url  # a moving branch could change the weights


def test_shipped_checksum_file_lists_the_weights():
    sha = dm.expected_sha256(dm.MODEL_DIR / "SHA256SUMS", dm.WEIGHTS_REL)
    assert len(sha) == 64
