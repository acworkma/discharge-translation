// Embeddings client for the meaning-fidelity scorer (ask3 §5).
//
// Uses the Azure OpenAI deployment-scoped path on the Foundry resource:
//   POST {foundryBase}/openai/deployments/{deployment}/embeddings?api-version=...
//
// The Foundry Models inference `/models/embeddings` router does NOT correctly
// resolve AOAI embedding deployments (e.g. `text-embedding-3-large-015418`):
// it strips the deployment suffix and routes to a legacy
// `/v1/engines/{base-model}/embeddings` path, which returns HTTP 200 with an
// empty body (grpc-status 12 in the headers). We bypass it and hit the AOAI
// deployment route directly. Chat completions keep using `@azure-rest/ai-inference`
// because that router works for OpenAI-deployed chat models.

import { credential, config, COGNITIVE_SERVICES_SCOPE } from './azure';

const EMBED_API_VERSION = process.env.AZURE_EMBEDDING_API_VERSION || '2024-10-21';

function foundryBase(): string {
  if (!config.foundryEndpoint) {
    throw new Error('AZURE_FOUNDRY_ENDPOINT not configured (required for embeddings)');
  }
  // Strip trailing `/models` (the inference-API suffix) and any trailing slash
  // so we can append AOAI-style paths.
  return config.foundryEndpoint.replace(/\/+$/, '').replace(/\/models$/, '');
}

async function authHeaders(): Promise<Record<string, string>> {
  if (config.foundryApiKey) {
    return { 'api-key': config.foundryApiKey };
  }
  const token = await credential().getToken(COGNITIVE_SERVICES_SCOPE);
  if (!token?.token) {
    throw new Error('Failed to acquire AAD token for cognitiveservices scope');
  }
  return { Authorization: `Bearer ${token.token}` };
}

export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const url = `${foundryBase()}/openai/deployments/${encodeURIComponent(
    config.embeddingDeployment
  )}/embeddings?api-version=${EMBED_API_VERSION}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeaders())
    },
    body: JSON.stringify({ input: texts })
  });

  if (!res.ok) {
    let detail = '';
    try {
      const errBody = (await res.json()) as { error?: { message?: string } };
      detail = errBody?.error?.message ?? '';
    } catch {
      detail = (await res.text().catch(() => '')) || '';
    }
    throw new Error(`Embeddings ${res.status}: ${detail || res.statusText}`);
  }

  const body = (await res.json()) as {
    data?: Array<{ embedding: number[]; index?: number }>;
  };
  const data = body.data ?? [];
  // Preserve order per OpenAI/Foundry spec (responses match request order).
  const sorted = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return sorted.map((d) => d.embedding);
}

export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
