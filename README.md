# Discharge Translation Lab

Translate U.S. hospital discharge documents into the five most common patient
languages and **let engines compete** on the same document. Every engine gets
scored on a clinical-CTQS rubric so a reviewer can pick the winner.

> Hack-on-Keyboard build. Not yet a regulated medical device.

## What it does

1. Upload a discharge document (DOCX / PDF / MD / TXT, English source).
2. Pick a target language: **Spanish, Vietnamese, Mandarin (Simplified), Arabic, Tagalog**.
3. Pick one or more engines to race:
   - **Azure AI Translator** — Text Translation v3 (NMT baseline).
   - **Azure AI Document Translation** — async batch NMT that preserves DOCX/PDF formatting natively.
   - **Azure AI Foundry models** — GPT-5.x, Mistral Large 3, Llama 3.3, DeepSeek V3.2, … via the Model Inference API.
4. The orchestrator runs every engine in parallel against the **same canonical Markdown intermediate**, so format fidelity is measured apples-to-apples.
5. Each output gets a **CTQS score** (Critical-to-Quality Score, 0–100) plus a publish/review/reject decision, and you can diff any two outputs line-by-line.

## Scoring (CTQS)

Weighted blend — see [src/lib/scoring](src/lib/scoring) for the implementation.

| Component | Weight | Signal |
| --- | --- | --- |
| **Format fidelity** | 0.25 | Markdown signature diff: heading order / count, bullets, numbered lists, tables (count + row×col shape), paragraphs, **placeholder round-trip** (`[[PHn]]` tokens that protect doses, ICD-10, dates, times, numerics). |
| **Meaning fidelity** | 0.45 | Round-trip back-translation → segment-aligned cosine similarity using `text-embedding-3-large`. Mean cosine in `[0.5, 1.0]` is remapped to `[0, 100]`. |
| **Safety (LLM-as-judge)** | 0.30 | Single `gpt-5-mini` Likert call (1–5) with structured JSON output and a rationale. Defensive fallback to score 60 if the judge errors. |

Plus a **critical-error detector** that runs alongside (numeric mismatch, dose drift, negation drift). Any **high-severity** finding triggers a hard reject; medium/low subtract soft penalties (15 / 7 / 3 each).

Decision thresholds: `ctqs >= 90` → auto-publish; `>= 80` → human review; else reject.

## Stack

- **Next.js 14** App Router + TypeScript + Tailwind, single Azure Container App.
- **Azure AI Translator v3** (NMT baseline) and **Azure AI Document Translation 2024-05-01** (async batch).
- **Azure AI Foundry** Model Inference API via `@azure-rest/ai-inference`.
- **`text-embedding-3-large`** for back-translation cosine.
- **DefaultAzureCredential + UAMI** for AAD; api-key fallbacks for local dev.
- **Azure Blob** (uploads + outputs) + **Azure Table** (metadata). No Cosmos.
- DOCX in/out via `mammoth` (parse) + `turndown` (HTML→Markdown) + `docx` (Markdown→DOCX). PDF in via `pdf-parse`; PDF out is plaintext via `pdfkit`.

## Local dev

```bash
cp .env.example .env.local
npm install
npm run dev
# open http://localhost:3000  (password: fr24)
```

For local AAD against Azure: `az login`. The app uses `DefaultAzureCredential`.

## Required env vars

| Variable | Purpose |
| --- | --- |
| `APP_PASSWORD` | Shared password (default `fr24`). |
| `SESSION_SECRET` | HMAC key for session cookie. |
| `AZURE_TRANSLATOR_ENDPOINT`, `AZURE_TRANSLATOR_REGION` | Azure AI Translator v3. |
| `AZURE_DOC_TRANSLATOR_ENDPOINT` | Document Translation endpoint (defaults to Translator endpoint). |
| `AZURE_FOUNDRY_ENDPOINT`, `AZURE_FOUNDRY_MODELS_JSON` | Foundry inference endpoint and model catalog. |
| `AZURE_EMBEDDING_DEPLOYMENT` | Embedding deployment name (default `text-embedding-3-large`). |
| `AZURE_JUDGE_MODEL` | Safety judge model (default `gpt-5-mini`). |
| `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_UPLOADS_CONTAINER`, `AZURE_STORAGE_UPLOADS_TABLE`, `AZURE_STORAGE_RUNS_TABLE` | Storage backend. |
| `AZURE_CLIENT_ID` | UAMI client id in Azure; blank locally. |

Optional key fallbacks for local: `AZURE_TRANSLATOR_KEY`, `AZURE_FOUNDRY_API_KEY`.

## Samples

The [samples/](samples/) folder contains three synthetic discharge documents
for the validation harness:

- `discharge-clean.md` — fully formed reference document.
- `discharge-missing-table.md` — medications table dropped.
- `discharge-heading-swap.md` — section headings reordered.

These are intended as Markdown fixtures the harness can re-render to DOCX on
the fly. Drop in `.docx` versions to exercise the Document Translation engine.

## PHI defaults

- Document text is **never logged** — only IDs, lengths, and statuses.
- Blob and Table use AAD (no shared keys).
- Downloads are short-lived SAS URLs generated via user delegation keys.
- Delete-on-demand from the dashboard cascades to runs.

## Known gaps (Hack-on-Keyboard scope cuts)

These are intentionally out-of-scope for the demo build:

- **No PII redaction.** Text Analytics for Health is not wired in.
- **No Cosmos migration.** Run metadata stays in Azure Table.
- **No Entra ID auth.** Shared password (`fr24`) is retained per scope.
- **No Blob immutability or WORM retention.**
- **No OCR.** Scanned PDFs will produce empty Markdown.
- **No Custom Translator.** No domain-tuned NMT model.
- **No inter-rater calibration.** The LLM-as-judge is uncalibrated against clinician annotators.
- **No `/metrics` endpoint or SLO dashboards.**
- **Heading-text comparison is count-only.** Cross-language heading-text equivalence requires a glossary; for now we compare counts and order positions.
- **Safety judge is a single call**, not an ensemble or self-consistency vote.

## Roadmap

1. ✅ **M1** — scaffold, auth, async runs, ACA deploy.
2. ✅ **M2** — real Translator + Foundry calls, Blob storage, signed URLs, DOCX/PDF parsing.
3. ✅ **M3** — real CTQS scoring (format / meaning / safety / critical errors), leaderboard + diff UI, Document Translation runner.
4. ⏳ **M4** — Entra ID auth, RBAC, audit log, PII redaction, Custom Translator tuning, inter-rater calibration.

## Deploy

GitHub Actions workflow at [.github/workflows/deploy.yml](.github/workflows/deploy.yml) builds the image, pushes to ACR, and deploys via Bicep ([infra/main.bicep](infra/main.bicep)).

Required GitHub secrets: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` (OIDC federated identity), `APP_PASSWORD`.
