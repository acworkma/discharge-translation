# Shared markdown structure-signature port (mirrors src/lib/structure.ts).
# Pure-Python, no deps.

from __future__ import annotations
import re
from dataclasses import dataclass, field
from typing import List


@dataclass
class TableDim:
    rows: int
    cols: int


@dataclass
class StructureSignature:
    headings: List[dict] = field(default_factory=list)  # [{level:int, text:str}]
    bullet_items: int = 0
    numbered_items: int = 0
    tables: List[TableDim] = field(default_factory=list)
    paragraphs: int = 0
    placeholders: List[str] = field(default_factory=list)


_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
_BULLET_RE = re.compile(r"^[-*]\s+")
_NUMBERED_RE = re.compile(r"^\d+[.)]\s+")
_TABLE_ROW_RE = re.compile(r"^\|.*\|$")
_PH_RE = re.compile(r"\[\[PH\d+\]\]")


def signature_of(markdown: str) -> StructureSignature:
    """Mirror of `signatureOf` in src/lib/structure.ts.

    Iterates the document line-by-line and aggregates structural counts.
    Critical contract: the values returned here must match the TypeScript
    implementation exactly for the same input — see the parity test.
    """
    sig = StructureSignature()
    placeholders_set: set[str] = set()

    in_table = False
    table_rows = 0
    table_cols = 0
    in_paragraph = False

    def close_table():
        nonlocal in_table, table_rows, table_cols
        if in_table:
            sig.tables.append(TableDim(rows=table_rows, cols=table_cols))
            in_table = False
            table_rows = 0
            table_cols = 0

    def close_paragraph():
        nonlocal in_paragraph
        if in_paragraph:
            sig.paragraphs += 1
            in_paragraph = False

    for line in markdown.replace("\r\n", "\n").split("\n"):
        trimmed = line.strip()
        for m in _PH_RE.finditer(trimmed):
            placeholders_set.add(m.group(0))

        if not trimmed:
            close_table()
            close_paragraph()
            continue

        h = _HEADING_RE.match(trimmed)
        if h:
            close_table()
            close_paragraph()
            sig.headings.append({"level": len(h.group(1)), "text": _normalize_heading(h.group(2))})
            continue

        if _BULLET_RE.match(trimmed):
            close_table()
            close_paragraph()
            sig.bullet_items += 1
            continue

        if _NUMBERED_RE.match(trimmed):
            close_table()
            close_paragraph()
            sig.numbered_items += 1
            continue

        if _TABLE_ROW_RE.match(trimmed):
            close_paragraph()
            stripped = re.sub(r"\s", "", trimmed)
            is_separator = bool(re.match(r"^\|:?-{3,}.*\|$", stripped))
            if not in_table:
                in_table = True
                table_rows = 0
                table_cols = len([c for c in trimmed.split("|") if c != ""])
            if not is_separator:
                table_rows += 1
            continue

        # Regular paragraph line.
        close_table()
        in_paragraph = True

    close_table()
    close_paragraph()
    sig.placeholders = sorted(placeholders_set)
    return sig


def _normalize_heading(s: str) -> str:
    return re.sub(r"\s+", " ", s.strip()).lower()
