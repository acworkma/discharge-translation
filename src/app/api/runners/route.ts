import { NextResponse } from 'next/server';
import {
  listAvailableFoundryModels,
  listAvailableFoundryAgents,
  azureTranslator,
  azureDocTranslator
} from '@/lib/runners';
import { config } from '@/lib/azure';

export const dynamic = 'force-dynamic';

export async function GET() {
  const runners: Array<Record<string, unknown>> = [
    {
      id: azureTranslator.id,
      displayName: azureTranslator.displayName,
      kind: 'translator',
      provider: 'azure',
      tier: 'baseline'
    }
  ];
  // Document Translation requires either a dedicated endpoint or the shared
  // Translator endpoint. If neither is set, hide it.
  if (config.docTranslatorEndpoint) {
    runners.push({
      id: azureDocTranslator.id,
      displayName: azureDocTranslator.displayName,
      kind: 'doc-translator',
      provider: 'azure',
      tier: 'baseline'
    });
  }
  // Foundry prompt agents (Phase 2, feat/foundry-demo). Listed before the
  // raw model list so the agent path is the default surfaced choice when
  // both are available — the agent is the Foundry-portal-managed prompt.
  if (config.aiProjectEndpoint) {
    runners.push(
      ...listAvailableFoundryAgents().map((a) => ({
        id: `foundry-agent:${a.name}`,
        displayName: `Foundry Agent · ${a.display || a.name}`,
        kind: 'foundry-agent',
        provider: a.provider,
        tier: a.tier,
        agentName: a.name,
        modelHint: a.modelHint
      }))
    );
  }
  runners.push(
    ...listAvailableFoundryModels().map((m) => ({
      id: `foundry:${m.id}`,
      displayName: `Foundry · ${m.display || m.id}`,
      kind: 'foundry',
      provider: m.provider,
      tier: m.tier,
      modelId: m.id
    }))
  );
  return NextResponse.json({ runners });
}
