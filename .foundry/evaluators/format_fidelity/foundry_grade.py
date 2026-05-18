# Self-contained blob for evaluator_catalog_create (Phase 4).
#
# Foundry's evaluator catalog expects a single `grade(sample, item) -> float`
# function with no project-local imports — the sandbox can't see our shared
# _common/structure.py. So this file inlines the structure scanner from
# .foundry/evaluators/_common/structure.py plus the scorer logic from
# .foundry/evaluators/format_fidelity/evaluator.py.
#
# Mirror invariant: every change to either source must be mirrored here.
# The Phase 4 parity harness compares this blob's outputs to the TS scorer
# row-by-row across discharge-baseline-v1.

import re
from dataclasses import dataclass, field
from typing import List

# ---------- structure scanner (port of src/lib/structure.ts) ----------

@dataclass
class _TableDim:
    rows: int
    cols: int

@dataclass
class _Sig:
    headings: List[dict] = field(default_factory=list)
    bullet_items: int = 0
    numbered_items: int = 0
    tables: List[_TableDim] = field(default_factory=list)
    paragraphs: int = 0
    placeholders: List[str] = field(default_factory=list)

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
_BULLET_RE = re.compile(r"^[-*]\s+")
_NUMBERED_RE = re.compile(r"^\d+[.)]\s+")
_TABLE_ROW_RE = re.compile(r"^\|.*\|$")
_PH_RE = re.compile(r"\[\[PH\d+\]\]")


def _sig(md: str) -> _Sig:
    s = _Sig()
    phs: set[str] = set()
    in_table = False
    rows = 0
    cols = 0
    in_para = False

    def close_table():
        nonlocal in_table, rows, cols
        if in_table:
            s.tables.append(_TableDim(rows=rows, cols=cols))
            in_table = False
            rows = 0
            cols = 0

    def close_para():
        nonlocal in_para
        if in_para:
            s.paragraphs += 1
            in_para = False

    for line in md.replace("\r\n", "\n").split("\n"):
        t = line.strip()
        for m in _PH_RE.finditer(t):
            phs.add(m.group(0))
        if not t:
            close_table()
            close_para()
            continue
        h = _HEADING_RE.match(t)
        if h:
            close_table()
            close_para()
            s.headings.append({"level": len(h.group(1)), "text": re.sub(r"\s+", " ", h.group(2).strip()).lower()})
            continue
        if _BULLET_RE.match(t):
            close_table()
            close_para()
            s.bullet_items += 1
            continue
        if _NUMBERED_RE.match(t):
            close_table()
            close_para()
            s.numbered_items += 1
            continue
        if _TABLE_ROW_RE.match(t):
            close_para()
            stripped = re.sub(r"\s", "", t)
            is_sep = bool(re.match(r"^\|:?-{3,}.*\|$", stripped))
            if not in_table:
                in_table = True
                rows = 0
                cols = len([c for c in t.split("|") if c != ""])
            if not is_sep:
                rows += 1
            continue
        close_table()
        in_para = True

    close_table()
    close_para()
    s.placeholders = sorted(phs)
    return s


# ---------- scorer (port of src/lib/scoring/format-fidelity.ts) ----------

_W = {
    "heading_order": 0.20,
    "heading_count": 0.10,
    "bullet_count": 0.10,
    "numbered_count": 0.10,
    "table_count": 0.15,
    "table_shape": 0.15,
    "paragraph_count": 0.10,
    "placeholders": 0.10,
}


def _ratio(a: int, b: int) -> float:
    if a == 0 and b == 0:
        return 100.0
    lo, hi = min(a, b), max(a, b)
    if hi == 0:
        return 100.0
    return (lo / hi) * 100.0


def _table_shape(src, tgt) -> float:
    if not src and not tgt:
        return 100.0
    if not src or not tgt:
        return 0.0
    n = min(len(src), len(tgt))
    acc = 0.0
    for i in range(n):
        rs = _ratio(src[i].rows, tgt[i].rows)
        cs = _ratio(src[i].cols, tgt[i].cols)
        acc += (rs + cs) / 2
    extras = abs(len(src) - len(tgt))
    return max(0.0, (acc / n) - extras * 10)


def _ph_score(src, tgt) -> float:
    if not src and not tgt:
        return 100.0
    if not src:
        return 100.0
    tgt_set = set(tgt)
    present = sum(1 for p in src if p in tgt_set)
    orphans = sum(1 for p in tgt if p not in src)
    base = (present / len(src)) * 100
    return max(0.0, base - orphans * 5)


# ---------- Foundry-required entrypoint ----------

def grade(sample: dict, item: dict) -> float:  # noqa: ARG001
    """Return the 0-100 format-fidelity score for a single dataset row.

    `sample` is the dataset row (query + response + metadata). `item` is the
    evaluator config (unused here). Returns a single float — sub-metrics are
    available in the local Python evaluator but the Foundry catalog API
    is single-metric per evaluator.
    """
    src = _sig(sample.get("query", "") or "")
    tgt = _sig(sample.get("response", "") or "")
    h_cnt = _ratio(len(src.headings), len(tgt.headings))
    score = 100 * (
        _W["heading_order"] * (h_cnt / 100)
        + _W["heading_count"] * (h_cnt / 100)
        + _W["bullet_count"] * (_ratio(src.bullet_items, tgt.bullet_items) / 100)
        + _W["numbered_count"] * (_ratio(src.numbered_items, tgt.numbered_items) / 100)
        + _W["table_count"] * (_ratio(len(src.tables), len(tgt.tables)) / 100)
        + _W["table_shape"] * (_table_shape(src.tables, tgt.tables) / 100)
        + _W["paragraph_count"] * (_ratio(src.paragraphs, tgt.paragraphs) / 100)
        + _W["placeholders"] * (_ph_score(src.placeholders, tgt.placeholders) / 100)
    )
    return round(score * 10) / 10
