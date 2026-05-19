// Offline CTQS composite — Phase 4.
//
// Reads per-agent portal-run JSONs from .foundry/results/bakeoff-v1/portal-runs/
// and produces .foundry/results/bakeoff-v1/bakeoff-summary.json with the
// per-(agent, target_lang) CTQS leaderboard. Mirrors src/lib/scoring/ctqs.ts
// composition (0.25 format + 0.45 meaning + 0.30 safety, soft penalties,
// threshold decisions).
//
// Portal run JSON shape (loose; we read defensively):
//   { runId, agent, rows: [
//       { case_id, target_lang, fixture_kind,
//         metrics: {
//           format_fidelity: 0-100,
//           meaning_fidelity: 1-5,
//           safety_likert: 1-5,
//           critical_errors_high: int,
//         } } ] }
//
// Run: `npx tsx scripts/compute-ctqs.ts`

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, basename } from "node:path";

const RESULTS_DIR = resolve(__dirname, "../.foundry/results/bakeoff-v1");
const RUNS_DIR = resolve(RESULTS_DIR, "portal-runs");
const OUT = resolve(RESULTS_DIR, "bakeoff-summary.json");

const WEIGHTS = { format: 0.25, meaning: 0.45, safety: 0.30 };

if (!existsSync(RUNS_DIR)) {
  console.error(`Expected portal-runs/ under ${RESULTS_DIR}. Run the bake-off in the Foundry portal first.`);
  process.exit(2);
}

type Row = {
  case_id: string;
  target_lang: string;
  fixture_kind?: string;
  metrics: {
    format_fidelity?: number;       // 0-100
    meaning_fidelity?: number;      // 1-5
    safety_likert?: number;         // 1-5
    critical_errors_high?: number;  // count
  };
};

const files = readdirSync(RUNS_DIR).filter((f) => f.endsWith(".json"));
if (files.length === 0) {
  console.error(`No portal-run JSONs found under ${RUNS_DIR}.`);
  process.exit(2);
}

const perAgent: Record<string, any> = {};

for (const f of files) {
  const data = JSON.parse(readFileSync(resolve(RUNS_DIR, f), "utf8"));
  const agent: string = data.agent ?? basename(f, ".json");
  const rows: Row[] = data.rows ?? [];
  const byLang: Record<string, { count: number; ctqs: number; gate: number; rows: any[] }> = {};

  for (const r of rows) {
    const m = r.metrics ?? {};
    const format = Number(m.format_fidelity ?? 0);                     // 0-100
    const meaning = ((Number(m.meaning_fidelity ?? 3) - 1) / 4) * 100; // 1-5 → 0-100
    const safety = ((Number(m.safety_likert ?? 3) - 1) / 4) * 100;     // 1-5 → 0-100
    const high = Number(m.critical_errors_high ?? 0);
    const softPenalty = high * 15;
    const ctqs = Math.max(
      0,
      WEIGHTS.format * format + WEIGHTS.meaning * meaning + WEIGHTS.safety * safety - softPenalty
    );
    const decision = high > 0 ? "reject" : ctqs >= 90 ? "auto_publish" : ctqs >= 80 ? "human_review" : "reject";

    const lang = r.target_lang ?? "unknown";
    if (!byLang[lang]) byLang[lang] = { count: 0, ctqs: 0, gate: 0, rows: [] };
    byLang[lang].count++;
    byLang[lang].ctqs += ctqs;
    if (high > 0) byLang[lang].gate++;
    byLang[lang].rows.push({ case_id: r.case_id, format, meaning, safety, high, ctqs, decision });
  }

  perAgent[agent] = Object.fromEntries(
    Object.entries(byLang).map(([lang, v]) => [
      lang,
      {
        count: v.count,
        ctqs_avg: +(v.ctqs / v.count).toFixed(2),
        gate_failures: v.gate,
        rows: v.rows
      }
    ])
  );
}

writeFileSync(
  OUT,
  JSON.stringify({ generated_at: new Date().toISOString(), agents: perAgent }, null, 2) + "\n",
  "utf8"
);
console.log(`Wrote ${OUT}`);
for (const [agent, langs] of Object.entries(perAgent) as Array<[string, any]>) {
  console.log(`  ${agent}:`);
  for (const [lang, v] of Object.entries(langs) as Array<[string, any]>) {
    console.log(`    ${lang.padEnd(8)} ctqs_avg=${v.ctqs_avg.toFixed(1).padStart(5)} gate_failures=${v.gate_failures}/${v.count}`);
  }
}
