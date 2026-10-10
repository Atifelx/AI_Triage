from __future__ import annotations

import pytest

from app.services.errors import InvalidModelOutputError
from app.services.severity_parser import parse_severity_output


@pytest.mark.parametrize("label", ["P1", "P2", "P3", "P4"])
def test_accepts_exact_training_format(label):
    assert parse_severity_output(f'{{"severity":"{label}"}}') == label


def test_accepts_surrounding_whitespace():
    assert parse_severity_output('  {"severity": "P2"}\n') == "P2"


@pytest.mark.parametrize(
    "raw",
    [
        "",
        "   ",
        "P1",
        '{"severity":"P1"',  # truncated
        "severity: P1",
        '```json\n{"severity":"P1"}\n```',  # no markdown repair
        "The severity is P1",
    ],
)
def test_rejects_invalid_json(raw):
    with pytest.raises(InvalidModelOutputError):
        parse_severity_output(raw)


@pytest.mark.parametrize(
    "raw",
    [
        '{"severity":"P0"}',
        '{"severity":"P5"}',
        '{"severity":"p1"}',
        '{"severity":"Critical"}',
        '{"severity":1}',
        '{"severity":null}',
        '{"severity":["P1"]}',
    ],
)
def test_rejects_invalid_severity(raw):
    with pytest.raises(InvalidModelOutputError):
        parse_severity_output(raw)


@pytest.mark.parametrize(
    "raw",
    ['["P1"]', '"P1"', "1", '{"label":"P1"}', '{"severity":"P1","confidence":0.9}', "{}"],
)
def test_rejects_wrong_shape(raw):
    with pytest.raises(InvalidModelOutputError):
        parse_severity_output(raw)


def test_rejects_non_string():
    with pytest.raises(InvalidModelOutputError):
        parse_severity_output(None)  # type: ignore[arg-type]
