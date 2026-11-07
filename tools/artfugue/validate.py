"""Validate pipeline output against the JSON Schemas in /schema."""

from __future__ import annotations

import json

from jsonschema import Draft202012Validator

from .paths import ROOT

SCHEMA_DIR = ROOT / "schema"


def _validator(name: str) -> Draft202012Validator:
    schema = json.loads((SCHEMA_DIR / name).read_text(encoding="utf-8"))
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def validate(kind: str, data: dict) -> None:
    """kind: 'notes' | 'pieces' | 'events'. Raises ValueError listing the first problems."""
    v = _validator(f"{kind}.v1.json")
    errors = sorted(v.iter_errors(data), key=lambda e: list(e.absolute_path))
    if errors:
        msg = "; ".join(f"{'/'.join(map(str, e.absolute_path))}: {e.message}" for e in errors[:5])
        raise ValueError(f"{kind} schema validation failed ({len(errors)} errors): {msg}")
