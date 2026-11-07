"""Low-level helpers for reading the MXL (compressed MusicXML) directly with lxml."""

import zipfile

from lxml import etree

from .paths import MXL


def load_root(path=MXL) -> etree._Element:
    """Return the root element of the score XML inside the .mxl archive."""
    with zipfile.ZipFile(path) as z:
        name = next(
            n for n in z.namelist() if n.endswith(".xml") and not n.startswith("META-INF")
        )
        return etree.fromstring(z.read(name), etree.XMLParser(huge_tree=True))
