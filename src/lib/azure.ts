// Shared Azure config + credential.
// Uses DefaultAzureCredential so the same code works with:
//   - User-Assigned Managed Identity in Azure Container Apps (AZURE_CLIENT_ID set)
//   - `az login` developer credential locally
//   - Workload Identity in CI

import { DefaultAzureCredential, type TokenCredential } from '@azure/identity';

let _cred: TokenCredential | null = null;

export function credential(): TokenCredential {
  if (!_cred) {
    _cred = new DefaultAzureCredential({
      managedIdentityClientId: process.env.AZURE_CLIENT_ID
    });
  }
  return _cred;
}

export const config = {
  storageAccount: process.env.AZURE_STORAGE_ACCOUNT || '',
  uploadsContainer: process.env.AZURE_STORAGE_UPLOADS_CONTAINER || 'uploads',
  uploadsTable: process.env.AZURE_STORAGE_UPLOADS_TABLE || 'uploads',
  runsTable: process.env.AZURE_STORAGE_RUNS_TABLE || 'runs',

  translatorEndpoint: process.env.AZURE_TRANSLATOR_ENDPOINT || '',
  translatorRegion: process.env.AZURE_TRANSLATOR_REGION || 'eastus2',
  // Optional: if set, key auth is used instead of MI (handy for local dev).
  translatorKey: process.env.AZURE_TRANSLATOR_KEY || '',

  // Azure AI Document Translation (async, format-preserving NMT). May share
  // the same Translator resource; if unset we fall back to translatorEndpoint.
  docTranslatorEndpoint:
    process.env.AZURE_DOC_TRANSLATOR_ENDPOINT ||
    process.env.AZURE_TRANSLATOR_ENDPOINT ||
    '',

  foundryEndpoint: process.env.AZURE_FOUNDRY_ENDPOINT || '',
  foundryApiKey: process.env.AZURE_FOUNDRY_API_KEY || '',
  foundryModels: parseFoundryModels(),

  // Embeddings deployment used by the meaning-fidelity scorer (back-translation
  // cosine, ask3 §5). Default is text-embedding-3-large; swap to a successor
  // (text-embedding-4 / GPT-5 embedding) via env when it reaches the region.
  embeddingDeployment:
    process.env.AZURE_EMBEDDING_DEPLOYMENT || 'text-embedding-3-large',

  // Judge model for the SafetyScore stub (ask3 §13 Day-1).
  judgeModel: process.env.AZURE_JUDGE_MODEL || 'gpt-5-mini'
};

export interface FoundryModelInfo {
  /** Deployment name in the foundry account (used as the `model` field in inference calls). */
  id: string;
  /** Human-friendly label; falls back to id. */
  display?: string;
  /** openai | mistral | meta | deepseek | other */
  provider: string;
  /** flagship | balanced | budget */
  tier: string;
}

function parseFoundryModels(): FoundryModelInfo[] {
  const raw = process.env.AZURE_FOUNDRY_MODELS_JSON;
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return arr
          .filter((x) => x && typeof x.id === 'string')
          .map((x) => ({
            id: String(x.id),
            display: x.display ? String(x.display) : undefined,
            provider: String(x.provider || 'other'),
            tier: String(x.tier || 'balanced')
          }));
      }
    } catch {
      // fall through
    }
  }
  // Legacy comma-separated fallback
  const csv = process.env.AZURE_FOUNDRY_MODELS || '';
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((id) => ({ id, provider: 'other', tier: 'balanced' }));
}

export function blobEndpoint(): string {
  if (!config.storageAccount) throw new Error('AZURE_STORAGE_ACCOUNT not configured');
  return `https://${config.storageAccount}.blob.core.windows.net`;
}

export function tableEndpoint(): string {
  if (!config.storageAccount) throw new Error('AZURE_STORAGE_ACCOUNT not configured');
  return `https://${config.storageAccount}.table.core.windows.net`;
}

// Cognitive Services data plane scope used for AAD-based Translator calls.
export const COGNITIVE_SERVICES_SCOPE = 'https://cognitiveservices.azure.com/.default';
