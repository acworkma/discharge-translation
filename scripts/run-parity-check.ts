// Phase 4 parity harness.
//
// Runs the TypeScript deterministic scorers (format-fidelity, critical-errors)
// against every row in .foundry/datasets/discharge-baseline-v1.jsonl using a
// supplied candidate translation column. Writes a JSON results file under
// .foundry/results/bakeoff-v1/.
//
// The companion script run-parity-check.py runs the Python evaluators against
// the same input and writes a sibling JSON. A third pass (compare-parity.ts)
// asserts the two files match within ±0.1 — this is the live mirror invariant
// for Phase 4, applied across all 45 dataset rows rather than the 5 fixtures
// from Phase 3.
//
// Candidate translations come from one of three sources:
//   --candidate=identity    (default) use source as candidate; smoke wiring.
//   --candidate=<file.jsonl> map by case_id from the supplied file.
//   --candidate=portal      pull from .foundry/results/bakeoff-v1/portal-runs/<agent>.jsonl.
//
// Run: npx tsx scripts/run-parity-check.ts [--candidate=identity]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { signatureOf } from "../src/lib/structure";
import { scoreFormat } from "../src/lib/scoring/format-fidelity";
import { detectCriticalErrors } from "../src/lib/scoring/critical-errors";

const REPO_ROOT = resolve(__dirname, "..");
const DATASET = resolve(REPO_ROOT, ".foundry/datasets/discharge-baseline-v1.jsonl");
const OUT_DIR = resolve(REPO_ROOT, ".foundry/results/bakeoff-v1");
const OUT_PATH = resolve(OUT_DIR, "parity-ts.json");

type Row = {
  case_id: string;
  query: string;
  response: string;
  source_lang: string;
  target_lang: string;
  fixture_kind: string;
};

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v = "true"] = a.replace(/^--/, "").split("=");
    return [k, v];
  })
);
const candidateMode = (args.candidate as string) ?? "identity";

const rows = readFileSync(DATASET, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as Row);

let candidateMap: Map<string, string> | null = null;
if (candidateMode !== "identity") {
  const path = resolve(REPO_ROOT, candidateMode);
  candidateMap = new Map();
  for (const line of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
    const r = JSON.parse(line) as { case_id: string; response: string };
    candidateMap.set(r.case_id, r.response);
  }
}

const results = rows.map((row) => {
  const candidate =
    candidateMap?.get(row.case_id) ?? (candidateMode === "identity" ? row.query : "");
  if (!candidate) {
    return { case_id: row.case_id, skipped: true, reason: "no candidate" };
  }
  const sig = signatureOf(row.query);
  const tgtSig = signatureOf(candidate);
  const format = scoreFormat(sig, tgtSig);
  const errors = detectCriticalErrors({
    sourceMarkdown: row.query,
    targetMarkdown: candidate,
    sourceLang: row.source_lang,
    targetLang: row.target_lang
  });
  const high = errors.filter((e) => e.severity === "high").length;
  const medium = errors.filter((e) => e.severity === "medium").length;
  const low = errors.filter((e) => e.severity === "low").length;
  return {
    case_id: row.case_id,
    fixture_kind: row.fixture_kind,
    target_lang: row.target_lang,
    format_fidelity: format.score,
    heading_order: format.headingOrder,
    table_shape: format.tableShape,
    placeholders: format.placeholders,
    critical_errors_count: errors.length,
    critical_errors_high: high,
    critical_errors_medium: medium,
    critical_errors_low: low,
    critical_gate_failed: high > 0,
    details: errors
  };
});

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(
  OUT_PATH,
  JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      candidate_mode: candidateMode,
      dataset: "discharge-baseline-v1",
      rows: results
    },
    null,
    2
  ) + "\n",
  "utf8"
);
const summary = results.reduce<Record<string, number>>((acc, r: any) => {
  if (r.skipped) return acc;
  acc.count = (acc.count ?? 0) + 1;
  acc.format_avg = (acc.format_avg ?? 0) + r.format_fidelity;
  acc.errors = (acc.errors ?? 0) + r.critical_errors_count;
  return acc;
}, {});
if (summary.count) summary.format_avg = +(summary.format_avg / summary.count).toFixed(2);
console.log(`Wrote ${results.length} rows to ${OUT_PATH}`);
console.log("Summary:", summary);
