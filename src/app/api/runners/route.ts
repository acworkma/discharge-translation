import { NextResponse } from 'next/server';
import { listAvailableFoundryModels, azureTranslator } from '@/lib/runners';

export async function GET() {
  return NextResponse.json({
    runners: [
      { id: azureTranslator.id, displayName: azureTranslator.displayName, kind: 'translator' },
      ...listAvailableFoundryModels().map((m) => ({
        id: `foundry:${m}`,
        displayName: `Azure AI Foundry / ${m}`,
        kind: 'foundry'
      }))
    ]
  });
}
