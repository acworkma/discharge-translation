import { NextResponse } from 'next/server';
import { store } from '@/lib/storage';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get('file') as File | null;
  const sourceLang = String(form.get('sourceLang') || 'en');
  const targetLang = String(form.get('targetLang') || 'es');
  if (!file) return NextResponse.json({ error: 'file required' }, { status: 400 });

  const buf = Buffer.from(await file.arrayBuffer());
  const previewSafe = buf.toString('utf8', 0, Math.min(buf.length, 200));
  const rec = await store.saveUpload(
    {
      filename: file.name,
      mimeType: file.type || 'application/octet-stream',
      sizeBytes: buf.length,
      sourceLang,
      targetLang,
      textPreview: previewSafe
    },
    buf
  );
  return NextResponse.json({ id: rec.id });
}

export async function GET() {
  return NextResponse.json({ uploads: await store.listUploads() });
}
