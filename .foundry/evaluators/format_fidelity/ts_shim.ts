// Parity shim: read {sourceMarkdown, targetMarkdown} JSON from stdin,
// write the TS scoreFormat() output as JSON to stdout. Used by the
// Python parity test under .foundry/evaluators/format_fidelity/ to enforce
// the "mirror invariant" between the TS and Python format-fidelity scorers.

import { scoreFormat } from "../../../src/lib/scoring/format-fidelity";
import { signatureOf } from "../../../src/lib/structure";

async function main() {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const { sourceMarkdown, targetMarkdown } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const result = scoreFormat(signatureOf(sourceMarkdown), signatureOf(targetMarkdown));
  process.stdout.write(JSON.stringify(result));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
