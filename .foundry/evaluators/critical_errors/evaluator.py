"""Critical-errors evaluator — mirrors src/lib/scoring/critical-errors.ts.

Three deterministic rules:
  - numeric_mismatch   — number multiset drift
  - dose_change       — dose multiset drift (value + canonical unit)
  - negation_drift    — negation density drop between source and target/back-translation
"""

from __future__ import annotations
import re
from collections import Counter
from dataclasses import dataclass
from typing import Optional


# Unit synonyms — (regex, canonical). Mirrors UNIT_SYNONYMS in the TS twin.
_UNIT_SYNONYMS: list[tuple[re.Pattern, str]] = [
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

# Build a single unit alternation matching all canonical surface forms.
def _build_unit_pattern() -> str:
    alts: list[str] = []
    for pat, _canon in _UNIT_SYNONYMS:
        src = pat.pattern
        if src.startswith("^"):
            src = src[1:]
        if src.endswith("$"):
            src = src[:-1]
        if src.startswith("(") and src.endswith(")"):
            src = src[1:-1]
        alts.append(src)
    return "|".join(alts)


_UNIT_PATTERN = _build_unit_pattern()
_DOSE_RE = re.compile(
    r"(?<![A-Za-z0-9])(\d+(?:[.,]\d+)?)\s*(" + _UNIT_PATTERN + r")(?![A-Za-z0-9])",
    re.I | re.U,
)
_NUMBER_RE = re.compile(r"\b\d+(?:\.\d+)?\b")

_NEGATION = {
    "en": {
        "source": ["not", "no", "never", "cannot", "can't", "don't", "avoid", "without", "stop", "discontinue"],
        "target": [],
    },
    "es": {"source": [], "target": ["no", "nunca", "jamás", "sin", "evite", "evitar", "deje", "suspender", "tampoco"]},
    "vi": {"source": [], "target": ["không", "chưa", "tránh", "ngừng", "đừng", "chớ"]},
    "zh-Hans": {"source": [], "target": ["不", "没", "没有", "别", "请勿", "禁止", "停止", "避免"]},
    "ar": {"source": [], "target": ["لا", "ليس", "ممنوع", "تجنب", "توقف", "بدون", "دون"]},
    "tl": {"source": [], "target": ["hindi", "huwag", "wala", "iwasan", "itigil", "tigilan", "walang"]},
}


@dataclass
class Dose:
    value: float
    unit: str


class CriticalErrorsEvaluator:
    """Returns the list of detected critical errors plus a high-severity gate flag."""

    def __call__(
        self,
        *,
        source_markdown: str,
        target_markdown: str,
        source_lang: str = "en",
        target_lang: str = "es",
        back_translation_markdown: Optional[str] = None,
        **_,
    ) -> dict:
        errors = detect_critical_errors(
            source_markdown=source_markdown,
            target_markdown=target_markdown,
            source_lang=source_lang,
            target_lang=target_lang,
            back_translation_markdown=back_translation_markdown,
        )
        high = sum(1 for e in errors if e["severity"] == "high")
        med = sum(1 for e in errors if e["severity"] == "medium")
        low = sum(1 for e in errors if e["severity"] == "low")
        return {
            "critical_errors_count": len(errors),
            "critical_errors_high": high,
            "critical_errors_medium": med,
            "critical_errors_low": low,
            "critical_gate_failed": bool(high > 0),
            "details": errors,
        }


def detect_critical_errors(
    *,
    source_markdown: str,
    target_markdown: str,
    source_lang: str,
    target_lang: str,
    back_translation_markdown: Optional[str] = None,
) -> list[dict]:
    errors: list[dict] = []

    # numeric_mismatch
    tgt_for_numbers = _normalize_decimal_commas(target_markdown)
    src_nums = sorted(_NUMBER_RE.findall(source_markdown))
    tgt_nums = sorted(_NUMBER_RE.findall(tgt_for_numbers))
    missing, extra = _symmetric_multiset_diff(src_nums, tgt_nums)
    if missing or extra:
        errors.append({
            "kind": "numeric_mismatch",
            "severity": "high" if (len(missing) + len(extra)) > 2 else "medium",
            "detail": f"Numeric set drift: missing={missing[:5]} extra={extra[:5]}",
        })

    # dose_change
    src_doses = _extract_doses(source_markdown)
    tgt_doses = _extract_doses(target_markdown)
    for issue in _compare_doses(src_doses, tgt_doses):
        errors.append({"kind": "dose_change", "severity": "high", "detail": issue})

    # negation_drift
    src_key = (source_lang or "en").split("-")[0]
    src_vocab = _NEGATION.get(src_key, _NEGATION["en"])["source"]
    src_neg = _count_tokens(source_markdown, src_vocab)

    tgt_key = _match_lang_key(target_lang)
    tgt_vocab = _NEGATION.get(tgt_key, {}).get("target", [])
    tgt_neg = _count_tokens(target_markdown, tgt_vocab) if tgt_vocab else -1

    bt_neg = _count_tokens(back_translation_markdown, src_vocab) if back_translation_markdown else -1

    if src_neg > 0 and bt_neg == 0 and back_translation_markdown is not None:
        errors.append({
            "kind": "negation_drift",
            "severity": "high",
            "detail": f"Source has {src_neg} negation tokens but back-translation has 0 — possible negation drop.",
        })
    if src_neg > 0 and tgt_neg == 0:
        errors.append({
            "kind": "negation_drift",
            "severity": "medium",
            "detail": f"Source has {src_neg} negation tokens but target language detected 0 ({tgt_key}).",
        })

    return errors


def _canonical_unit(raw: str) -> str:
    for pat, canon in _UNIT_SYNONYMS:
        if pat.match(raw):
            return canon
    return raw.lower()


def _extract_doses(s: str) -> list[Dose]:
    out: list[Dose] = []
    for m in _DOSE_RE.finditer(s):
        num = m.group(1).replace(",", ".")
        out.append(Dose(value=float(num), unit=_canonical_unit(m.group(2))))
    return out


def _compare_doses(src: list[Dose], tgt: list[Dose]) -> list[str]:
    key = lambda d: f"{d.value}|{d.unit}"
    src_map: Counter[str] = Counter(key(d) for d in src)
    tgt_map: Counter[str] = Counter(key(d) for d in tgt)

    missing: list[Dose] = []
    extra: list[Dose] = []
    for d in src:
        k = key(d)
        if src_map[k] > tgt_map[k]:
            missing.append(d)
            src_map[k] -= 1
    for d in tgt:
        k = key(d)
        if tgt_map[k] > src_map[k]:
            extra.append(d)
            tgt_map[k] -= 1

    issues: list[str] = []
    # Greedy pair by unit (value-vs-unit drift distinction).
    for m in list(missing):
        idx = next((i for i, e in enumerate(extra) if e.unit == m.unit), -1)
        if idx >= 0:
            e = extra.pop(idx)
            issues.append(f"Dose value changed: {m.value}{m.unit} → {e.value}{e.unit}")
            missing.remove(m)
    for m in list(missing):
        if extra:
            e = extra.pop(0)
            issues.append(f"Dose unit changed: {m.value}{m.unit} → {e.value}{e.unit}")
            missing.remove(m)
    for m in missing:
        issues.append(f"Dose dropped: {m.value}{m.unit}")
    for e in extra:
        issues.append(f"Dose added: {e.value}{e.unit}")
    return issues


def _normalize_decimal_commas(s: str) -> str:
    return re.sub(r"(\d),(\d{1,3})(?!\d)", r"\1.\2", s)


def _symmetric_multiset_diff(a: list[str], b: list[str]) -> tuple[list[str], list[str]]:
    a_map, b_map = Counter(a), Counter(b)
    missing: list[str] = []
    extra: list[str] = []
    for k, v in a_map.items():
        d = v - b_map.get(k, 0)
        missing.extend([k] * d)
    for k, v in b_map.items():
        d = v - a_map.get(k, 0)
        extra.extend([k] * d)
    return missing, extra


def _count_tokens(s: Optional[str], vocab: list[str]) -> int:
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


def _match_lang_key(lang: str) -> str:
    l = (lang or "").lower()
    if l.startswith("zh"):
        return "zh-Hans"
    if l.startswith("es"):
        return "es"
    if l.startswith("vi"):
        return "vi"
    if l.startswith("ar"):
        return "ar"
    if l.startswith("tl") or l.startswith("fil"):
        return "tl"
    return l
