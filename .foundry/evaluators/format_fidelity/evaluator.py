"""Format-fidelity evaluator — mirrors src/lib/scoring/format-fidelity.ts.

Foundry custom-evaluator protocol: class with `__call__(**inputs)` returning
a dict of metric name -> numeric (or string) values. The metric names declared
here must match the `metrics` block in spec.yaml.
"""

from __future__ import annotations
import sys
from pathlib import Path

# Allow running via `python -m evaluators.format_fidelity.evaluator` or
# directly via `python evaluator.py`. Add the _common shared module on path.
_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE.parent / "_common"))

from structure import StructureSignature, signature_of  # type: ignore  # noqa: E402

_WEIGHTS = {
    "heading_order": 0.20,
    "heading_count": 0.10,
    "bullet_count": 0.10,
    "numbered_count": 0.10,
    "table_count": 0.15,
    "table_shape": 0.15,
    "paragraph_count": 0.10,
    "placeholders": 0.10,
}


class FormatFidelityEvaluator:
    """Deterministic structural comparison; no LLM, no network."""

    def __call__(self, *, source_markdown: str, target_markdown: str, **_) -> dict:
        src = signature_of(source_markdown)
        tgt = signature_of(target_markdown)
        return score_format(src, tgt)


def score_format(src: StructureSignature, tgt: StructureSignature) -> dict:
    heading_count = _ratio(len(src.headings), len(tgt.headings))
    heading_order = _ratio(len(src.headings), len(tgt.headings))  # parity with TS
    bullet_count = _ratio(src.bullet_items, tgt.bullet_items)
    numbered_count = _ratio(src.numbered_items, tgt.numbered_items)
    table_count = _ratio(len(src.tables), len(tgt.tables))
    table_shape = _table_shape(src.tables, tgt.tables)
    paragraph_count = _ratio(src.paragraphs, tgt.paragraphs)
    placeholders = _placeholder_score(src.placeholders, tgt.placeholders)

    score = 100 * (
        _WEIGHTS["heading_order"] * (heading_order / 100)
        + _WEIGHTS["heading_count"] * (heading_count / 100)
        + _WEIGHTS["bullet_count"] * (bullet_count / 100)
        + _WEIGHTS["numbered_count"] * (numbered_count / 100)
        + _WEIGHTS["table_count"] * (table_count / 100)
        + _WEIGHTS["table_shape"] * (table_shape / 100)
        + _WEIGHTS["paragraph_count"] * (paragraph_count / 100)
        + _WEIGHTS["placeholders"] * (placeholders / 100)
    )
    return {
        "format_fidelity": _r1(score),
        "heading_order": _r1(heading_order),
        "heading_count": _r1(heading_count),
        "bullet_count": _r1(bullet_count),
        "numbered_count": _r1(numbered_count),
        "table_count": _r1(table_count),
        "table_shape": _r1(table_shape),
        "paragraph_count": _r1(paragraph_count),
        "placeholders": _r1(placeholders),
    }


def _ratio(a: int, b: int) -> float:
    if a == 0 and b == 0:
        return 100.0
    lo, hi = min(a, b), max(a, b)
    if hi == 0:
        return 100.0
    return (lo / hi) * 100.0


def _table_shape(src: list, tgt: list) -> float:
    if not src and not tgt:
        return 100.0
    if not src or not tgt:
        return 0.0
    n = min(len(src), len(tgt))
    acc = 0.0
    for i in range(n):
        row_score = _ratio(src[i].rows, tgt[i].rows)
        col_score = _ratio(src[i].cols, tgt[i].cols)
        acc += (row_score + col_score) / 2
    extras = abs(len(src) - len(tgt))
    return max(0.0, (acc / n) - extras * 10)


def _placeholder_score(src: list, tgt: list) -> float:
    if not src and not tgt:
        return 100.0
    if not src:
        return 100.0
    tgt_set = set(tgt)
    present = sum(1 for p in src if p in tgt_set)
    orphans = sum(1 for p in tgt if p not in src)
    base = (present / len(src)) * 100
    return max(0.0, base - orphans * 5)


def _r1(n: float) -> float:
    return round(n * 10) / 10
