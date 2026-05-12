import { NextResponse } from 'next/server';
import { store } from '@/lib/storage';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const u = await store.getUpload(params.id);
  if (!u) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const runs = await store.listRunsForUpload(u.id);
  return NextResponse.json({ upload: u, runs });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  await store.deleteUpload(params.id);
  return NextResponse.json({ ok: true });
}
