import { NextResponse } from 'next/server';
import { listAvailableFoundryModels, azureTranslator } from '@/lib/runners';

export async function GET() {
  return NextResponse.json({
    runners: [
      {
        id: azureTranslator.id,
        displayName: azureTranslator.displayName,
        kind: 'translator',
        provider: 'azure',
        tier: 'baseline'
      },
      ...listAvailableFoundryModels().map((m) => ({
        id: `foundry:${m.id}`,
        displayName: `Foundry · ${m.display || m.id}`,
        kind: 'foundry',
        provider: m.provider,
        tier: m.tier,
        modelId: m.id
      }))
    ]
  });
}
