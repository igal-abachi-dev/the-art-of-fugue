"""The build id and the audio hashes (T9.1.2): the URLs the app asks for change when the files do."""

import json

from artfugue.fingerprint import MANIFEST, STATIC, audio_src, data_build, file_digest


def make(tmp_path, body=b"a"):
    (tmp_path / "data" / "pieces").mkdir(parents=True)
    (tmp_path / "samples").mkdir()
    (tmp_path / "data" / "pieces" / "c01.bin").write_bytes(body)
    (tmp_path / "samples" / "A0.mp3").write_bytes(b"s")
    (tmp_path / "data" / "manifest.json").write_text("{}")
    return tmp_path


def test_the_build_id_follows_the_files_but_not_the_manifest(tmp_path):
    root = make(tmp_path)
    a = data_build(root)
    assert len(a) == 10
    (root / "data" / "manifest.json").write_text('{"build":"x","other":1}')
    assert data_build(root) == a  # the manifest holds the id, so it cannot be part of it
    (root / "data" / "pieces" / "c01.bin").write_bytes(b"b")
    assert data_build(root) != a
    (root / "data" / "pieces" / "c01.bin").write_bytes(b"a")
    assert data_build(root) == a
    (root / "samples" / "A0.mp3").write_bytes(b"t")
    assert data_build(root) != a  # the samples are versioned with the data


def test_an_audio_src_gets_the_hash_of_its_file_once(tmp_path):
    (tmp_path / "audio").mkdir()
    (tmp_path / "audio" / "x.webm").write_bytes(b"abc")
    once = audio_src("/audio/x.webm", tmp_path)
    assert once == f"/audio/x.webm?v={file_digest(tmp_path / 'audio' / 'x.webm')[:10]}"
    assert audio_src(once, tmp_path) == once
    assert audio_src("/audio/missing.webm", tmp_path) == "/audio/missing.webm"  # not committed: left alone


def test_the_shipped_manifest_carries_the_current_build_id():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    assert manifest["build"] == data_build(STATIC), "the data changed since `python -m artfugue.fingerprint` last ran"


def test_shipped_audio_sources_carry_the_hash_of_the_file_when_it_is_there():
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    for a in manifest["audio"]:
        assert "?v=" in a["src"], a["src"]
        path = STATIC / a["src"].split("?")[0].lstrip("/")
        if path.is_file():
            assert a["src"].endswith(file_digest(path)[:10])
