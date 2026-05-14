// LLM-judge SafetyScore stub (ask3 §13 Day-1).
// Single judge call: rate clinical safety 1–5 with rationale. NOT an inter-
// rater calibrated metric — that's Day-2+ work (ask3 §15).

import ModelClient, { isUnexpected } from '@azure-rest/ai-inference';
import { AzureKeyCredential } from '@azure/core-auth';
import { credential, config, COGNITIVE_SERVICES_SCOPE } from '../azure';
import type { SafetyBreakdown } from '../storage';

const SYSTEM = [
  'You are a clinical translation safety judge. Given a source discharge document and its translation,',
  'rate the safety of the translation on a 1–5 Likert scale where:',
  '  5 = clinically safe, no concerns',
  '  4 = minor wording issues, no clinical harm risk',
  '  3 = noticeable issues, low clinical risk',
  '  2 = clinically concerning, could mislead patient',
  '  1 = clinically dangerous, contains errors that could cause harm',
  'Return ONLY a JSON object: {"score": <int 1-5>, "rationale": "<one sentence>"}.',
  'Do not include markdown fences or any other text.'
].join(' ');

function judgeClient() {
  if (config.foundryApiKey) {
    return ModelClient(config.foundryEndpoint, new AzureKeyCredential(config.foundryApiKey));
  }
  return ModelClient(config.foundryEndpoint, credential(), {
    credentials: { scopes: [COGNITIVE_SERVICES_SCOPE] }
  });
}

export async function scoreSafety(args: {
  sourceMarkdown: string;
  targetMarkdown: string;
  sourceLang: string;
  targetLang: string;
}): Promise<SafetyBreakdown> {
  if (!config.foundryEndpoint) {
    // No judge available — return a neutral score with a clear rationale.
    return {
      score: 60,
      raw: 3,
      rationale: 'Judge unavailable: AZURE_FOUNDRY_ENDPOINT not configured.'
    };
  }
  const userPrompt =
    `Source language: ${args.sourceLang}\nTarget language: ${args.targetLang}\n\n` +
    `--- SOURCE ---\n${truncate(args.sourceMarkdown, 8000)}\n\n` +
    `--- TRANSLATION ---\n${truncate(args.targetMarkdown, 8000)}\n`;

  const isReasoningModel = /^(gpt-5|o[0-9])/i.test(config.judgeModel);
  try {
    const res = await judgeClient().path('/chat/completions').post({
      body: {
        model: config.judgeModel,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: userPrompt }
        ],
        ...(isReasoningModel
          ? { max_completion_tokens: 4096 }
          : { temperature: 0, max_tokens: 200 }),
        response_format: { type: 'json_object' }
      }
    });
    if (isUnexpected(res)) {
      throw new Error(`Judge ${res.status}`);
    }
    const content = (res.body.choices?.[0]?.message?.content ?? '') as string;
    const parsed = safeParse(content);
    const raw = clamp(Math.round(Number(parsed.score) || 3), 1, 5);
    const rationale =
      typeof parsed.rationale === 'string' && parsed.rationale.trim()
        ? parsed.rationale.trim().slice(0, 280)
        : 'No rationale returned.';
    return { score: ((raw - 1) / 4) * 100, raw, rationale };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'judge call failed';
    return { score: 60, raw: 3, rationale: `Judge error: ${msg.slice(0, 120)}` };
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…[truncated]' : s;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
function safeParse(s: string): { score?: unknown; rationale?: unknown } {
  try {
    return JSON.parse(s) as { score?: unknown; rationale?: unknown };
  } catch {
    // Try to recover a JSON object substring.
    const m = /\{[\s\S]*\}/.exec(s);
    if (m) {
      try {
        return JSON.parse(m[0]) as { score?: unknown; rationale?: unknown };
      } catch {
        // fall through
      }
    }
    return {};
  }
}
