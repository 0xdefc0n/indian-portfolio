"""Read a disclosure file into sheets of plain cell values, whatever its real format (plan §10.3.1, M18).

AMCs name files carelessly (PPFAS serves an xlsx as `.xls`), so the format comes from the bytes, not the name:
  - `PK..` zip: an xlsx/xlsm/xlsb workbook, or a zip archive of workbooks (several AMCs zip one file per scheme);
  - `D0 CF 11 E0` OLE: a legacy xls;
  - anything else is refused.
Excel is read with python-calamine (fast, handles xls, xlsx and xlsb), with openpyxl as the fallback for xlsx files
calamine refuses. Nothing is written to disk: everything stays in memory.
"""

from __future__ import annotations

import io
import zipfile
from dataclasses import dataclass

OLE = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
ZIP = b"PK\x03\x04"
EXCEL_EXT = (".xls", ".xlsx", ".xlsm", ".xlsb")
# A zip bomb guard: an archive may hold at most this many workbooks, this large in total once uncompressed.
MAX_MEMBERS = 400
MAX_UNZIPPED = 200 * 1024 * 1024
MAX_ROWS = 50_000  # per sheet; a scheme is a few hundred rows, but UTI puts all 87 schemes in one 9,375-row sheet


class UnreadableFile(Exception):
    """Not a workbook (an HTML error page, a PDF, a corrupt file)."""


@dataclass
class Sheet:
    file: str  # the workbook's file name (the member name inside a zip)
    name: str  # the sheet name
    rows: list[list[object]]


def _workbook_kind(content: bytes) -> str | None:
    if content.startswith(OLE):
        return "xls"
    if content.startswith(ZIP):
        try:
            names = zipfile.ZipFile(io.BytesIO(content)).namelist()
        except zipfile.BadZipFile:
            return None
        if "[Content_Types].xml" in names:
            return "xlsb" if any(n.endswith(".bin") and n.startswith("xl/") for n in names) else "xlsx"
        return "zip"
    return None


def _calamine(content: bytes) -> list[tuple[str, list[list[object]]]]:
    from python_calamine import CalamineWorkbook

    wb = CalamineWorkbook.from_filelike(io.BytesIO(content))
    out = []
    for name in wb.sheet_names:
        try:
            rows = wb.get_sheet_by_name(name).to_python(skip_empty_area=False, nrows=MAX_ROWS)
        except Exception:  # a chart sheet or a broken sheet: skip it, keep the others
            continue
        out.append((name, [list(r) for r in rows]))
    return out


def _openpyxl(content: bytes) -> list[tuple[str, list[list[object]]]]:
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    try:
        return [
            (ws.title, [["" if v is None else v for v in row] for _, row in zip(range(MAX_ROWS), ws.iter_rows(values_only=True))])
            for ws in wb.worksheets
        ]
    finally:
        wb.close()


def _read_workbook(content: bytes, kind: str) -> list[tuple[str, list[list[object]]]]:
    try:
        return _calamine(content)
    except Exception:
        if kind != "xlsx":
            raise UnreadableFile(kind) from None
    try:
        return _openpyxl(content)
    except Exception:
        raise UnreadableFile(kind) from None


def read_sheets(content: bytes, filename: str) -> list[Sheet]:
    """Every sheet of the file; a zip archive gives the sheets of every workbook inside it."""
    kind = _workbook_kind(content)
    if kind is None:
        raise UnreadableFile("not_a_workbook")
    if kind != "zip":
        return [Sheet(filename, name, rows) for name, rows in _read_workbook(content, kind)]
    sheets: list[Sheet] = []
    total = 0
    with zipfile.ZipFile(io.BytesIO(content)) as z:
        members = [i for i in z.infolist() if i.filename.lower().endswith(EXCEL_EXT) and not i.filename.startswith("__MACOSX/")]
        if len(members) > MAX_MEMBERS:
            raise UnreadableFile("zip_too_many")
        for info in members:
            total += info.file_size
            if total > MAX_UNZIPPED:
                raise UnreadableFile("zip_too_large")
            data = z.read(info)
            inner = _workbook_kind(data)
            if inner is None or inner == "zip":
                continue  # nested archives aren't a disclosure format
            name = info.filename.rsplit("/", 1)[-1]
            sheets += [Sheet(name, s, rows) for s, rows in _read_workbook(data, inner)]
    return sheets
