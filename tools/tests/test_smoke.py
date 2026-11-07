import zipfile

from artfugue.paths import MXL


def test_mxl_exists_and_is_a_zip():
    assert MXL.exists()
    assert zipfile.is_zipfile(MXL)
