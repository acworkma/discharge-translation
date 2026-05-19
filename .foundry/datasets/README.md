# .foundry/datasets/

Local cache for Foundry evaluation datasets used by the discharge-translation demo.

Per the `microsoft-foundry` skill, this folder is a **local cache** of dataset
content that gets uploaded to the Foundry project as versioned datasets. Reuse
files here when current; ask before refreshing or overwriting them.

## Contents

- `discharge-baseline-v1.jsonl` — Phase 4 seed dataset built from `samples/discharge-*.md`,
  split by target language (es, zh-Hans, ar, vi, tl).

The authoritative dataset record lives in the Foundry project
(`https://foundry-acw.services.ai.azure.com/api/projects/prj-discharge`) under the
name `discharge-baseline` (version 1). Files here are the upload source.
