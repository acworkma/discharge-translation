import { NextResponse } from 'next/server';
import {
  listAvailableFoundryModels,
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
