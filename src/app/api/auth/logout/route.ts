import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { clearSessionCookie } from '@/lib/auth';

export async function POST() {
  const c = clearSessionCookie();
  cookies().set(c.name, c.value, c.options);
  return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'));
}
