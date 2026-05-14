// Embeddings client for the meaning-fidelity scorer (ask3 §5).
//
// Uses the Azure AI Foundry inference endpoint with the deployment name in
// config.embeddingDeployment (default `text-embedding-3-large`). When the
// embedding-4 successor lands in-region, swap by setting
// AZURE_EMBEDDING_DEPLOYMENT — no code change required.

import ModelClient, { isUnexpected } from '@azure-rest/ai-inference';
import { AzureKeyCredential } from '@azure/core-auth';
import { credential, config, COGNITIVE_SERVICES_SCOPE } from './azure';

function client() {
  if (!config.foundryEndpoint) {
    throw new Error('AZURE_FOUNDRY_ENDPOINT not configured (required for embeddings)');
  }
  if (config.foundryApiKey) {
    return ModelClient(config.foundryEndpoint, new AzureKeyCredential(config.foundryApiKey));
  }
  return ModelClient(config.foundryEndpoint, credential(), {
    credentials: { scopes: [COGNITIVE_SERVICES_SCOPE] }
  });
}

export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const c = client();
  const res = await c.path('/embeddings').post({
    body: { model: config.embeddingDeployment, input: texts }
  });
  if (isUnexpected(res)) {
    const err = res.body as { error?: { message?: string } };
    throw new Error(
      `Embeddings ${res.status}: ${err?.error?.message ?? 'unknown error'}`
    );
  }
  const body = res.body as { data?: Array<{ embedding: number[]; index?: number }> };
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
