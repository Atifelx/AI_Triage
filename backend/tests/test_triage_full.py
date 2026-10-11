"""Full (five-field) incident triage: parser, assessment, prompts, API contract."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.services.errors import InvalidModelOutputError
from app.services.providers.base import IncidentInput, InferenceProvider, ProviderState, ProviderStatus
from app.services.providers.gemma_provider import GemmaSeverityProvider
from app.services.providers.gemma_triage_prompt import INCIDENT_LORA_PROFILE, V3_PROFILE
from app.services.providers.mock_provider import MOCK_TRIAGE_MODEL_ID, MockInferenceProvider
from app.services.triage_parser import assess_triage, evidence_found_in, parse_triage_output
from app.services.triage_service import load_offline_evaluation
from tests.conftest import client_for

REPO = Path(__file__).resolve().parents[2]

VALID = {
    "category": "network",
    "severity": "P2",
    "root_cause": "dns_resolution_failure",
    "evidence": ["DNS telemetry shows a common record problem."],
    "recommended_actions": ["Compare the failing record with authoritative DNS data."],
}


def raw(obj: object) -> str:
    return json.dumps(obj, separators=(",", ":"))


# ------------------------------------------------------------------ parser


def test_parses_valid_v3_output_including_human_review_flag():
    analysis = parse_triage_output(raw({**VALID, "human_review_required": True}), V3_PROFILE)
    assert analysis.as_dict() == VALID


@pytest.mark.parametrize(
    "text",
    [
        "```json\n" + raw(VALID) + "\n```",
        "Here is the result: " + raw(VALID) + " Done.",
    ],
)
def test_locates_object_in_fence_or_surrounding_text(text):
    assert parse_triage_output(text, V3_PROFILE).severity == "P2"


@pytest.mark.parametrize(
    "mutate, reason",
    [
        (lambda d: d.pop("root_cause"), "missing"),
        (lambda d: d.update(confidence=0.9), "unexpected"),
        (lambda d: d.update(severity="P5"), "severity"),
        (lambda d: d.update(severity="p2"), "severity"),
        (lambda d: d.update(category="email"), "category"),
        (lambda d: d.update(evidence="DNS broken"), "evidence"),
        (lambda d: d.update(evidence=["ok", 3]), "evidence"),
        (lambda d: d.update(recommended_actions=[""]), "recommended_actions"),
        (lambda d: d.update(root_cause=""), "root_cause"),
        (lambda d: d.update(human_review_required="yes"), "human_review_required"),
    ],
)
def test_rejects_contract_violations(mutate, reason):
    data = json.loads(raw(VALID))
    mutate(data)
    with pytest.raises(InvalidModelOutputError) as info:
        parse_triage_output(raw(data), V3_PROFILE)
    assert reason in (info.value.internal_detail or "")
    assert info.value.raw_output is not None


@pytest.mark.parametrize("text", ["", "   ", "not json", '{"category": "network"', "[1, 2]"])
def test_rejects_malformed_text(text):
    with pytest.raises(InvalidModelOutputError):
        parse_triage_output(text, V3_PROFILE)


def test_incident_lora_profile_has_exactly_five_keys():
    with pytest.raises(InvalidModelOutputError):
        parse_triage_output(raw({**VALID, "human_review_required": True}), INCIDENT_LORA_PROFILE)
    assert parse_triage_output(raw({**VALID, "category": "service_outage"}), INCIDENT_LORA_PROFILE)


# -------------------------------------------------------------- assessment


def test_evidence_grounding():
    incident = "Business impact: users are blocked. Diagnostic evidence: DNS telemetry shows a common record problem."
    assert evidence_found_in("DNS telemetry shows a common record problem.", incident)
    assert not evidence_found_in("Sign-in logs show AADSTS53003.", incident)


def assess(analysis_overrides: dict, **kwargs):
    analysis = parse_triage_output(raw({**VALID, **analysis_overrides}), V3_PROFILE)
    defaults = {
        "incident_text": "DNS telemetry shows a common record problem.",
        "diagnostic_evidence_supplied": True,
        "severity_check": "P2",
    }
    return assess_triage(analysis, V3_PROFILE, **{**defaults, **kwargs})


def test_consistent_grounded_answer_has_no_uncertainty():
    result = assess({})
    assert result.root_cause.label == "DNS resolution failure"
    assert result.root_cause.matches_category is True
    assert result.evidence_found == (True,)
    assert not result.uncertain


def test_uncertainty_notes():
    result = assess(
        {"root_cause": "made_up_cause", "evidence": ["Firewall logs show drops."]},
        diagnostic_evidence_supplied=False,
        severity_check="P1",
    )
    text = " ".join(result.notes)
    assert result.root_cause.in_taxonomy is False
    assert "not in the training taxonomy" in text
    assert "No diagnostic evidence was supplied" in text
    assert "not found in the submitted incident" in text
    assert "predicts P1, not P2" in text


def test_category_root_cause_mismatch_is_flagged():
    result = assess({"category": "teams"})
    assert result.root_cause.matches_category is False
    assert any("internally inconsistent" in n for n in result.notes)


# ----------------------------------------------------------------- prompts


@pytest.mark.skipif(not (REPO / "training/data/incident_test_v3.jsonl").is_file(), reason="training data absent")
def test_v3_prompt_matches_training_layout():
    row = json.loads((REPO / "training/data/incident_test_v3.jsonl").read_text().splitlines()[0])
    assert V3_PROFILE.build_user_message(row["input"]) == row["instruction"] + "\n\nIncident:\n" + row["input"]
    # The adapter's targets must validate against the profile used to parse them.
    assert parse_triage_output(row["output"], V3_PROFILE).severity == row["severity"]


# --------------------------------------------------------------------- API


def test_full_triage_mock_returns_all_five_fields(mock_client, valid_payload):
    res = mock_client.post("/api/v1/triage/full", json=valid_payload)
    assert res.status_code == 200, res.text
    body = res.json()
    assert set(body["analysis"]) == {"category", "severity", "root_cause", "evidence", "recommended_actions"}
    assert body["is_mock"] is True
    assert body["model_id"] == MOCK_TRIAGE_MODEL_ID
    assert body["human_review_required"] is True
    assert body["raw_output"] is None  # not exposed by default
    assert body["analysis"]["category"] == "authentication"
    assert body["severity_check"]["agrees"] is True
    assert [e["found_in_incident"] for e in body["evidence_support"]] == [True, True]
    assert body["request_id"] == res.headers["X-Request-ID"]


def test_raw_output_is_exposed_only_when_enabled(valid_payload):
    with client_for(MockInferenceProvider(), expose_raw_output=True) as client:
        body = client.post("/api/v1/triage/full", json=valid_payload).json()
    assert json.loads(body["raw_output"]) == body["analysis"]


@pytest.mark.parametrize("expose", [False, True])
def test_invalid_output_is_a_controlled_error(valid_payload, expose):
    payload = {**valid_payload, "title": "[mock-invalid] VPN outage"}
    with client_for(MockInferenceProvider(), expose_raw_output=expose) as client:
        res = client.post("/api/v1/triage/full", json=payload)
    assert res.status_code == 502
    error = res.json()["error"]
    assert error["code"] == "invalid_model_output"
    assert ("raw_output" in error) is expose


def test_inference_failure_maps_to_500(mock_client, valid_payload):
    res = mock_client.post("/api/v1/triage/full", json={**valid_payload, "title": "[mock-fail] outage"})
    assert res.status_code == 500
    assert res.json()["error"]["code"] == "inference_failed"


class SeverityOnlyProvider(InferenceProvider):
    name = "severity-only"
    is_mock = False

    @property
    def model_id(self) -> str:
        return "severity-only-test"

    def status(self) -> ProviderStatus:
        return ProviderStatus(state=ProviderState.READY, model_loaded=True)

    def _infer_raw(self, incident: IncidentInput) -> str:
        return '{"severity":"P3"}'


def test_provider_without_triage_adapter_reports_unavailable(valid_payload):
    with client_for(SeverityOnlyProvider()) as client:
        res = client.post("/api/v1/triage/full", json=valid_payload)
        assert res.status_code == 503
        assert res.json()["error"]["code"] == "triage_unavailable"
        # Severity-only triage keeps working.
        assert client.post("/api/v1/triage", json=valid_payload).json()["severity"] == "P3"
        triage = client.get("/health").json()["inference"]["triage"]
        assert triage["available"] is False


def test_health_reports_triage_capability(mock_client):
    triage = mock_client.get("/health").json()["inference"]["triage"]
    assert triage["available"] is True
    assert triage["model_id"] == MOCK_TRIAGE_MODEL_ID


def test_severity_only_endpoint_is_unchanged(mock_client, valid_payload):
    body = mock_client.post("/api/v1/triage", json=valid_payload).json()
    assert "analysis" not in body and "root_cause" not in body


def test_evaluation_unavailable_for_mock(mock_client):
    body = mock_client.get("/api/v1/triage/evaluation").json()
    assert body["available"] is False
    assert body["fine_tuned"] is None


# --------------------------------------------------------- offline metrics


def test_offline_evaluation_reads_shipped_file(tmp_path):
    adapter = tmp_path / "bundle" / "adapter"
    adapter.mkdir(parents=True)
    block = {"severity": {"correct": 43, "total": 100}, "category": {"correct": 100, "total": 100}}
    (adapter.parent / "evaluation_metrics.json").write_text(json.dumps({"base": block, "lora": block}))
    result = load_offline_evaluation(adapter, "bundle")
    assert result.available is True
    assert result.fine_tuned["severity"].accuracy == pytest.approx(0.43)
    assert result.not_measured  # evidence/action quality are reported as not measured


def test_offline_evaluation_missing_file_is_unavailable(tmp_path):
    result = load_offline_evaluation(tmp_path / "adapter", "x")
    assert result.available is False and result.fine_tuned is None
    assert load_offline_evaluation(None, None).available is False


# ------------------------------------------------- gemma triage capability


def test_gemma_without_triage_path_reports_not_configured(tmp_path):
    provider = GemmaSeverityProvider(base_model_id="google/gemma-3-270m-it", adapter_path=tmp_path)
    cap = provider.triage_capability()
    assert cap.available is False
    assert "TRIAGE_ADAPTER_PATH" in (cap.detail or "")


def test_gemma_missing_triage_dir_disables_triage_only(tmp_path):
    provider = GemmaSeverityProvider(
        base_model_id="google/gemma-3-270m-it",
        adapter_path=tmp_path,
        triage_adapter_path=tmp_path / "nope" / "adapter",
        triage_profile=V3_PROFILE,
    )

    class FakeModel:
        def load_adapter(self, *a, **k):  # pragma: no cover - must not be reached
            raise AssertionError("should not load a missing adapter")

    provider._load_triage_adapter(FakeModel())
    cap = provider.triage_capability()
    assert cap.available is False
    assert cap.adapter == "nope"
    assert "not found" in (cap.detail or "")


def test_gemma_rejects_triage_adapter_for_other_base_model(tmp_path):
    adapter = tmp_path / "other" / "adapter"
    adapter.mkdir(parents=True)
    (adapter / "adapter_config.json").write_text(json.dumps({"base_model_name_or_path": "google/gemma-3-1b-it"}))
    provider = GemmaSeverityProvider(
        base_model_id="google/gemma-3-270m-it",
        adapter_path=tmp_path,
        triage_adapter_path=adapter,
        triage_profile=V3_PROFILE,
    )
    provider._load_triage_adapter(object())
    assert "trained on 'google/gemma-3-1b-it'" in (provider.triage_capability().detail or "")


class SeverityDisagrees(MockInferenceProvider):
    def _infer_raw(self, incident: IncidentInput) -> str:
        return '{"severity":"P4"}'


class SeverityBroken(MockInferenceProvider):
    def _infer_raw(self, incident: IncidentInput) -> str:
        return "not json"


def test_final_severity_comes_from_the_severity_adapter(valid_payload):
    with client_for(SeverityDisagrees()) as client:
        body = client.post("/api/v1/triage/full", json=valid_payload).json()
    assert body["triage_severity"] == body["analysis"]["severity"] == "P1"  # triage adapter, untouched
    assert body["severity"] == "P4" and body["severity_source"] == "severity_adapter"
    assert body["severity_check"]["agrees"] is False
    assert not any("severity" in n.lower() for n in body["uncertainty_notes"])  # expected, not uncertainty


def test_falls_back_to_triage_severity_and_says_so(valid_payload):
    with client_for(SeverityBroken()) as client:
        body = client.post("/api/v1/triage/full", json=valid_payload).json()
    assert body["severity"] == body["analysis"]["severity"]
    assert body["severity_source"] == "triage_adapter"
    assert body["uncertain"] is True and any("could not be run" in n for n in body["uncertainty_notes"])
