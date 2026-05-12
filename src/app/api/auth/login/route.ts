import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSessionCookie, verifyPassword } from '@/lib/auth';

export async function POST(req: Request) {
  const { password } = await req.json().catch(() => ({ password: '' }));
  if (!password || !verifyPassword(String(password))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const c = createSessionCookie();
  cookies().set(c.name, c.value, c.options);
  return NextResponse.json({ ok: true });
}
