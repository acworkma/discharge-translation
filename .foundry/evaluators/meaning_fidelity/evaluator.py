"""Meaning-fidelity evaluator — mirrors src/lib/scoring/meaning-fidelity.ts.

Pipeline: back-translate target → source-language (Azure Translator), embed
both source and back-translation per line on an Azure OpenAI embedding model,
align ordinally, mean+min cosine, linear remap [0.5, 1.0] → [0, 100].

Networked. Requires AZURE_TRANSLATOR_ENDPOINT/REGION/KEY and
AZURE_FOUNDRY_ENDPOINT + AZURE_EMBEDDING_DEPLOYMENT in the evaluator runtime
environment, plus an AAD identity with the Translator/Cognitive Services roles
(or fall back to API keys for local dev).
"""

from __future__ import annotations
import os
import re
from typing import Iterable
import math


def segmentize(md: str) -> list[str]:
    """Match the segmentize() in meaning-fidelity.ts: split on \n+, strip
    leading markdown markers, drop empties and separator-only lines."""
    out: list[str] = []
    for s in re.split(r"\n+", md):
        s = re.sub(r"^\s*[#\->*\d.|]+\s*", "", s).strip()
        if not s:
            continue
        if re.fullmatch(r"[-:|\s]+", s):
            continue
        out.append(s)
    return out


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


class MeaningFidelityEvaluator:
    """Networked: back-translates + embeds. Falls back gracefully if env
    credentials are missing, returning a neutral score with a rationale so
    the evaluation suite doesn't fail hard during portal-side smoke runs."""

    def __init__(
        self,
        *,
        translator_endpoint: str | None = None,
        translator_region: str | None = None,
        translator_key: str | None = None,
        foundry_endpoint: str | None = None,
        embedding_deployment: str | None = None,
        foundry_api_key: str | None = None,
    ):
        self.translator_endpoint = translator_endpoint or os.getenv("AZURE_TRANSLATOR_ENDPOINT", "")
        self.translator_region = translator_region or os.getenv("AZURE_TRANSLATOR_REGION", "eastus2")
        self.translator_key = translator_key or os.getenv("AZURE_TRANSLATOR_KEY", "")
        self.foundry_endpoint = foundry_endpoint or os.getenv("AZURE_FOUNDRY_ENDPOINT", "")
        self.embedding_deployment = embedding_deployment or os.getenv(
            "AZURE_EMBEDDING_DEPLOYMENT", "text-embedding-3-large-015418"
        )
        self.foundry_api_key = foundry_api_key or os.getenv("AZURE_FOUNDRY_API_KEY", "")

    def __call__(
        self,
        *,
        source_markdown: str,
        target_markdown: str,
        source_lang: str = "en",
        target_lang: str = "es",
        **_,
    ) -> dict:
        if not self.translator_endpoint or not self.foundry_endpoint:
            return {
                "meaning_fidelity": 0.0,
                "mean_cosine": 0.0,
                "min_cosine": 0.0,
                "segments_compared": 0,
                "back_translation": "",
                "rationale": "Translator or Foundry endpoint not configured — evaluator skipped.",
            }

        back = self._back_translate(target_markdown, target_lang, source_lang)
        src_segs = segmentize(source_markdown)
        bt_segs = segmentize(back)
        if not src_segs or not bt_segs:
            return {
                "meaning_fidelity": 0.0,
                "mean_cosine": 0.0,
                "min_cosine": 0.0,
                "segments_compared": 0,
                "back_translation": back,
            }

        n = min(len(src_segs), len(bt_segs))
        vectors = self._embed(src_segs[:n] + bt_segs[:n])
        src_vecs = vectors[:n]
        bt_vecs = vectors[n:]

        sums = 0.0
        mn = 1.0
        for sv, bv in zip(src_vecs, bt_vecs):
            c = cosine(sv, bv)
            sums += c
            if c < mn:
                mn = c
        mean = sums / n
        remap = max(0.0, min(1.0, (mean - 0.5) / 0.5))
        score = remap * 100
        return {
            "meaning_fidelity": round(score * 10) / 10,
            "mean_cosine": round(mean * 1000) / 1000,
            "min_cosine": round(mn * 1000) / 1000,
            "segments_compared": n,
            "back_translation": back,
        }

    # ------------------------------------------------------------------
    # Azure clients (lazy-imported so the deterministic evaluators stay
    # dependency-free for unit tests).
    # ------------------------------------------------------------------
    def _back_translate(self, text: str, src_lang: str, tgt_lang: str) -> str:
        import requests  # type: ignore
        url = self.translator_endpoint.rstrip("/") + "/translate"
        headers = {
            "Ocp-Apim-Subscription-Region": self.translator_region,
            "Content-Type": "application/json",
        }
        if self.translator_key:
            headers["Ocp-Apim-Subscription-Key"] = self.translator_key
        else:
            tok = _aad_token("https://cognitiveservices.azure.com/.default")
            headers["Authorization"] = f"Bearer {tok}"
        params = {"api-version": "3.0", "from": src_lang, "to": tgt_lang, "textType": "plain"}
        r = requests.post(url, headers=headers, params=params, json=[{"text": text}], timeout=60)
        r.raise_for_status()
        return r.json()[0]["translations"][0]["text"]

    def _embed(self, texts: list[str]) -> list[list[float]]:
        import requests  # type: ignore
        url = (
            self.foundry_endpoint.rstrip("/")
            + f"/openai/deployments/{self.embedding_deployment}/embeddings?api-version=2024-10-21"
        )
        headers = {"Content-Type": "application/json"}
        if self.foundry_api_key:
            headers["api-key"] = self.foundry_api_key
        else:
            tok = _aad_token("https://cognitiveservices.azure.com/.default")
            headers["Authorization"] = f"Bearer {tok}"
        r = requests.post(url, headers=headers, json={"input": texts}, timeout=120)
        r.raise_for_status()
        return [d["embedding"] for d in r.json()["data"]]


def _aad_token(scope: str) -> str:
    from azure.identity import DefaultAzureCredential  # type: ignore
    return DefaultAzureCredential().get_token(scope).token
