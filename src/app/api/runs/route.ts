import { NextResponse } from 'next/server';
import { store } from '@/lib/storage';
import { startRun } from '@/lib/jobs';

export async function POST(req: Request) {
  const { uploadId, runners } = await req.json().catch(() => ({}));
  if (!uploadId || !Array.isArray(runners) || runners.length === 0) {
    return NextResponse.json({ error: 'uploadId and runners[] required' }, { status: 400 });
  }
  const upload = await store.getUpload(uploadId);
  if (!upload) return NextResponse.json({ error: 'upload not found' }, { status: 404 });
  const run = await store.createRun(uploadId, runners);
  // Fire-and-forget — surface errors via run.status; don't block the POST.
  void startRun(run.id).catch((err) => console.error('startRun failed', run.id, String(err)));
  return NextResponse.json({ id: run.id });
}

export async function GET() {
  return NextResponse.json({ runs: await store.listRuns() });
}
