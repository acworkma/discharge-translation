import { NextResponse } from 'next/server';
import { store } from '@/lib/storage';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const r = await store.getRun(params.id);
  if (!r) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const upload = await store.getUpload(r.uploadId);
  return NextResponse.json({ run: r, upload });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  await store.deleteRun(params.id);
  return NextResponse.json({ ok: true });
}
