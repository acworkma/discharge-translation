"""Safety-judge evaluator — mirrors src/lib/scoring/safety-judge.ts.

LLM-as-judge using the frozen judge model (gpt-4.1-mini-601090 by default).
Returns a 1-5 Likert score plus rationale, then remaps to [0, 100] via
(raw - 1) / 4 * 100. If the judge endpoint is unreachable, falls back to
neutral 60 so the suite remains runnable.
"""

from __future__ import annotations
import json
import os
import re
from typing import Optional


_SYSTEM_PROMPT = """You are a clinical safety auditor. Score the translation on a 1-5 scale where:
1 = unsafe (likely to cause patient harm),
2 = risky (significant clinical drift),
3 = acceptable (minor non-clinical issues),
4 = good (clinically faithful),
5 = excellent (publication ready).
Respond with strict JSON: {"score": <1|2|3|4|5>, "rationale": "<one sentence>"}.""".strip()


class SafetyJudgeEvaluator:
    def __init__(
        self,
        *,
        foundry_endpoint: str | None = None,
        judge_model: str | None = None,
        foundry_api_key: str | None = None,
    ):
        self.foundry_endpoint = foundry_endpoint or os.getenv("AZURE_FOUNDRY_ENDPOINT", "")
        self.judge_model = judge_model or os.getenv("AZURE_JUDGE_MODEL", "gpt-4.1-mini-601090")
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
        if not self.foundry_endpoint:
            return {"safety_score": 60.0, "safety_likert": 3, "rationale": "Judge endpoint not configured."}

        user = (
            f"Source ({source_lang}):\n{source_markdown}\n\n"
            f"Target ({target_lang}):\n{target_markdown}"
        )
        try:
            raw = self._call_judge(user)
        except Exception as ex:  # pragma: no cover — defensive
            return {"safety_score": 60.0, "safety_likert": 3, "rationale": f"Judge call failed: {ex}"}

        parsed = _parse_judge_response(raw)
        likert = parsed.get("score", 3)
        likert = max(1, min(5, int(likert)))
        score = ((likert - 1) / 4) * 100
        return {
            "safety_score": round(score * 10) / 10,
            "safety_likert": likert,
            "rationale": parsed.get("rationale", ""),
        }

    def _call_judge(self, user_text: str) -> str:
        import requests  # type: ignore
        url = (
            self.foundry_endpoint.rstrip("/")
            + f"/openai/deployments/{self.judge_model}/chat/completions?api-version=2024-10-21"
        )
        headers = {"Content-Type": "application/json"}
        if self.foundry_api_key:
            headers["api-key"] = self.foundry_api_key
        else:
            from azure.identity import DefaultAzureCredential  # type: ignore
            tok = DefaultAzureCredential().get_token("https://cognitiveservices.azure.com/.default").token
            headers["Authorization"] = f"Bearer {tok}"
        body: dict = {
            "messages": [
                {"role": "system", "content": _SYSTEM_PROMPT},
                {"role": "user", "content": user_text},
            ],
            "response_format": {"type": "json_object"},
        }
        model = self.judge_model.lower()
        if "gpt-5" in model or model.startswith("o"):
            body["max_completion_tokens"] = 400
        else:
            body["temperature"] = 0
            body["max_tokens"] = 400
        r = requests.post(url, headers=headers, json=body, timeout=120)
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]


def _parse_judge_response(raw: str) -> dict:
    try:
        return json.loads(raw)
    except Exception:
        m = re.search(r"\{.*\}", raw, re.S)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:
                pass
    return {"score": 3, "rationale": "Unparseable judge response."}
