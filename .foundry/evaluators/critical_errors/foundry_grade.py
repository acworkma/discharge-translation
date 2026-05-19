# Self-contained blob for evaluator_catalog_create (Phase 4).
#
# Mirrors src/lib/scoring/critical-errors.ts + .foundry/evaluators/critical_errors/evaluator.py.
# Returns the count of HIGH-severity critical errors as a single float.
# Desirable direction: decrease (lower is better). Pass threshold: 0.

import re
from collections import Counter
from typing import Optional


_UNIT_SYNONYMS = [
    (re.compile(r"^mg$", re.I), "mg"),
    (re.compile(r"^(mcg|μg|ug)$", re.I), "mcg"),
    (re.compile(r"^(ml|mL)$", re.I), "ml"),
    (re.compile(r"^(l|L|lt|lts|liters?|litres?|litros?)$", re.I), "l"),
    (re.compile(r"^(g|gramos?|grams?)$", re.I), "g"),
    (re.compile(r"^kg$", re.I), "kg"),
    (re.compile(r"^(iu|IU|unidad(?:es)?|units?|đơn vị|单位|وحدات?|yunit)$", re.I | re.U), "unit"),
    (re.compile(r"^(tablets?|tabs?|comprimidos?|tabletas?|viên|片|قرص|أقراص|tableta)$", re.I | re.U), "tablet"),
    (re.compile(r"^(caps?|cápsulas?|capsulas?|capsules?|viên nang|胶囊|كبسولات?|kapsula)$", re.I | re.U), "capsule"),
    (re.compile(r"^(drops?|gotas?|giọt|滴|قطرات?|patak)$", re.I | re.U), "drop"),
    (re.compile(r"^(sprays?|aerosol(?:es)?|pulverizaciones?|xịt|喷|بخة|بخات|spray)$", re.I | re.U), "spray"),
    (re.compile(r"^(puffs?|caladas?|inhalaciones?|nhát xịt|nhát hít|喷雾|بختة|hithit)$", re.I | re.U), "puff"),
    (re.compile(r"^%$"), "%"),
]


def _build_unit_pattern() -> str:
    alts = []
    for pat, _ in _UNIT_SYNONYMS:
        src = pat.pattern.removeprefix("^").removesuffix("$")
        if src.startswith("(") and src.endswith(")"):
            src = src[1:-1]
        alts.append(src)
    return "|".join(alts)


_DOSE_RE = re.compile(
    r"(?<![A-Za-z0-9])(\d+(?:[.,]\d+)?)\s*(" + _build_unit_pattern() + r")(?![A-Za-z0-9])",
    re.I | re.U,
)
_NUMBER_RE = re.compile(r"\b\d+(?:\.\d+)?\b")
_NEGATION = {
    "en": ["not", "no", "never", "cannot", "can't", "don't", "avoid", "without", "stop", "discontinue"],
    "es": ["no", "nunca", "jamás", "sin", "evite", "evitar", "deje", "suspender", "tampoco"],
    "vi": ["không", "chưa", "tránh", "ngừng", "đừng", "chớ"],
    "zh-Hans": ["不", "没", "没有", "别", "请勿", "禁止", "停止", "避免"],
    "ar": ["لا", "ليس", "ممنوع", "تجنب", "توقف", "بدون", "دون"],
    "tl": ["hindi", "huwag", "wala", "iwasan", "itigil", "tigilan", "walang"],
}


def _canonical_unit(raw: str) -> str:
    for pat, canon in _UNIT_SYNONYMS:
        if pat.match(raw):
            return canon
    return raw.lower()


def _doses(s: str):
    return [
        (float(m.group(1).replace(",", ".")), _canonical_unit(m.group(2)))
        for m in _DOSE_RE.finditer(s)
    ]


def _norm_commas(s: str) -> str:
    return re.sub(r"(\d),(\d{1,3})(?!\d)", r"\1.\2", s)


def _count_tokens(s: str, vocab: list[str]) -> int:
    if not s or not vocab:
        return 0
    lower = " " + s.lower() + " "
    c = 0
    for w in vocab:
        is_ascii = all(ord(ch) < 128 for ch in w)
        escaped = re.escape(w)
        pat = re.compile(rf"\b{escaped}\b", re.I) if is_ascii else re.compile(escaped)
        c += len(pat.findall(lower))
    return c


def _lang(t: str) -> str:
    t = (t or "").lower()
    if t.startswith("zh"):
        return "zh-Hans"
    if t.startswith("es"):
        return "es"
    if t.startswith("vi"):
        return "vi"
    if t.startswith("ar"):
        return "ar"
    if t.startswith("tl") or t.startswith("fil"):
        return "tl"
    return t.split("-")[0]


def grade(sample: dict, item: dict) -> float:  # noqa: ARG001
    """Return the count of HIGH-severity critical errors as a float (lower is better)."""
    source = sample.get("query", "") or ""
    target = sample.get("response", "") or ""
    src_lang = sample.get("source_lang", "en")
    tgt_lang = sample.get("target_lang", "es")

    high = 0

    # numeric_mismatch (high if >2 drift)
    src_nums = sorted(_NUMBER_RE.findall(source))
    tgt_nums = sorted(_NUMBER_RE.findall(_norm_commas(target)))
    a, b = Counter(src_nums), Counter(tgt_nums)
    miss = sum((a - b).values())
    extra = sum((b - a).values())
    if (miss + extra) > 2:
        high += 1

    # dose_change (always high if any drift)
    src_doses = _doses(source)
    tgt_doses = _doses(target)
    a2 = Counter(src_doses)
    b2 = Counter(tgt_doses)
    if (a2 - b2) or (b2 - a2):
        high += 1

    # negation_drift (high if source has negations but back-translation is missing).
    # Without a back-translation we approximate using the target-language vocab.
    src_neg = _count_tokens(source, _NEGATION.get(_lang(src_lang), _NEGATION["en"]))
    tgt_vocab = _NEGATION.get(_lang(tgt_lang), [])
    tgt_neg = _count_tokens(target, tgt_vocab) if tgt_vocab else -1
    if src_neg > 0 and tgt_neg == 0:
        high += 1

    return float(high)
