"""Version the shipped files so that the host may cache them for good (T9.1.2).

Run:  python -m artfugue.fingerprint          (the last step of ``pnpm data``)

The data and the samples keep their file names, so a long ``immutable`` cache header is only safe if the URL changes when a
file does. This hashes every file under ``web/static/data`` (except the manifest) and ``web/static/samples`` and writes the first
ten characters of the digest into the manifest as ``build``; the app then asks for ``…?v=<build>`` (``web/src/lib/data/version.ts``).
Each audio file that exists gets its own hash as the query of its ``src`` (``/audio/fugue.webm?v=…``). The manifest is the one
file that is fetched without a version, and the host revalidates it.

Idempotent: running it twice on the same files changes nothing.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from .paths import ROOT

STATIC = ROOT / "web" / "static"
MANIFEST = STATIC / "data" / "manifest.json"
HASH_LEN = 10
VERSIONED_DIRS = ("data", "samples")


def file_digest(path: Path) -> str:
    h = hashlib.sha1()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def data_build(static: Path = STATIC) -> str:
    """The id of the data files: a digest of every file's path and bytes, in path order, without the manifest."""
    h = hashlib.sha1()
    for d in VERSIONED_DIRS:
        for path in sorted((static / d).rglob("*")):
            if not path.is_file() or path == static / "data" / "manifest.json":
                continue
            h.update(path.relative_to(static).as_posix().encode())
            h.update(b"\0")
            h.update(file_digest(path).encode())
            h.update(b"\0")
    return h.hexdigest()[:HASH_LEN]


def audio_src(src: str, static: Path = STATIC) -> str:
    """``src`` with ``?v=<hash of the file>`` if the file is there; unchanged otherwise (it is not committed)."""
    path = static / src.split("?")[0].lstrip("/")
    if not path.is_file():
        return src
    return f"{src.split('?')[0]}?v={file_digest(path)[:HASH_LEN]}"


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    manifest["build"] = data_build()
    for a in manifest.get("audio", []):
        a["src"] = audio_src(a["src"])
    MANIFEST.write_text(json.dumps(manifest, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"build {manifest['build']}; audio: " + ", ".join(a["src"] for a in manifest.get("audio", [])))


if __name__ == "__main__":
    main()
