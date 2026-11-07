import json

import pytest

from artfugue import annotate, build_score
from artfugue.paths import MXL, WORK
from artfugue.score import parse_score

SCORE = WORK / "score"


@pytest.fixture(scope="session")
def score():
    return parse_score()


# Without data/raw (the recording, the MXL and the PDF are not in the repository, as in CI) only the tests that
# read the shipped data under web/static/data can run.
NEEDS_NO_RAW = ("test_notation", "test_fingerprint", "test_samples", "test_overview", "test_sync_acceptance")


def pytest_collection_modifyitems(config, items):
    if MXL.exists():
        return
    skip = pytest.mark.skip(reason="data/raw is not present (not in the repository)")
    for item in items:
        if item.module.__name__.split(".")[-1] not in NEEDS_NO_RAW:
            item.add_marker(skip)


@pytest.fixture(scope="session", autouse=True)
def built():
    """Rebuild all score data once per test session so the tests check current code."""
    if not MXL.exists():
        return
    build_score.main()
    annotate.main()


@pytest.fixture(scope="session")
def pieces(built):
    doc = json.loads((SCORE / "pieces.json").read_text(encoding="utf-8"))
    return {p["id"]: p for p in doc["pieces"]}


@pytest.fixture(scope="session")
def notes(built):
    def load(pid, unfolded=False):
        name = f"{pid}.unfolded.json" if unfolded else f"{pid}.json"
        return json.loads((SCORE / "notes" / name).read_text(encoding="utf-8"))["notes"]

    return load
