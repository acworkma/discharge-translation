# Discharge Translation Lab

Compare different translation methods (Azure AI Translator, Azure AI Foundry models, ...) for hospital discharge paperwork. Goal: translate while preserving **clinical meaning** and **formatting**, then **score** each method side-by-side.

> Status: **M2 in progress**. Real Azure Translator + Foundry calls, Blob + Table-backed storage, signed URLs. OCR/PDF/DOCX parsing and real scoring still ahead.

## Stack

- Next.js 14 (App Router) + TypeScript + Tailwind
- Single Azure Container App (frontend + API), Azure Linux base image
- Azure AI Translator (Text Translation v3) — AAD auth via UAMI
- Azure AI Foundry (Model Inference API) — AAD auth via UAMI
- Azure Storage: Blob (uploads + outputs) + Table (metadata), AAD-only (no shared key)

## Local dev

```bash
cp .env.example .env.local
npm install
npm run dev
# open http://localhost:3000  (password: fr24)
```

## Auth

Single shared password via `APP_PASSWORD` (default `fr24`). Session cookie is HMAC-signed using `SESSION_SECRET`.

## Runners (stubs)

- `azure-translator` — Azure AI Translator
- `foundry:<model>` — one runner per model in `AZURE_FOUNDRY_MODELS`

Selectable per upload on the **New Run** page.

## Scoring (stubs)

Each runner result returns five scores: clinical fidelity, terminology consistency, formatting preservation, readability, overall.

## PHI defaults

- Document text is **never logged**.
- Storage encrypted at rest (Azure Storage SSE).
- Downloads will use short-lived signed URLs once Blob is wired in.
- Delete-on-demand from the dashboard cascades to runs.

## Azure resources (CAF, eastus2, `rg-discharge`)

| Resource | Name |
|---|---|
| Container Apps Env | `cae-dt-prod-eus2-001` |
| Container App | `ca-dt-web-prod-eus2-001` |
| Container Registry | `crdtprodeus2001` |
| Storage | `stdtprodeus2001` |
| Key Vault | `kv-dt-prod-eus2-001` |
| Log Analytics | `log-dt-prod-eus2-001` |
| App Insights | `appi-dt-prod-eus2-001` |
| Translator | `cog-dt-trn-prod-eus2-001` |
| AI Foundry | `aif-dt-prod-eus2-001` |
| Managed Identity | `id-dt-prod-eus2-001` |

Bicep: [infra/main.bicep](infra/main.bicep)

## Deploy

GitHub Actions workflow [.github/workflows/deploy.yml](.github/workflows/deploy.yml) builds the image, pushes to ACR, and deploys via Bicep.

Required GitHub secrets:
- `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID` (OIDC federated identity)
- `APP_PASSWORD` (defaults to `fr24`)

## Roadmap

1. **M1 (this scaffold)** — auth, upload, async stubbed runs, side-by-side results, ACA deploy.
2. **M2** — real Azure Translator + Foundry calls, Blob storage, signed URLs, OCR/PDF/DOCX parsing.
3. **M3** — real scoring (clinical NER terminology check, format diff, COMET/BLEURT), reviewer notes.
4. **M4** — Entra ID auth, RBAC, audit log.
