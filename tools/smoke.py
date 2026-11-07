"""Smoke test for the Python toolchain: opens the MXL and prints its part count."""

import zipfile

from lxml import etree

from artfugue.paths import MXL


def main() -> None:
    with zipfile.ZipFile(MXL) as z:
        name = next(n for n in z.namelist() if n.endswith(".xml") and not n.startswith("META-INF"))
        root = etree.fromstring(z.read(name))
    parts = root.findall(".//part")
    measures = [len(p.findall("measure")) for p in parts]
    print(f"{MXL.name}: {len(parts)} parts, measures per part = {measures}")


if __name__ == "__main__":
    main()
