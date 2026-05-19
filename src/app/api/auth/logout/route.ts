import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { clearSessionCookie } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const c = clearSessionCookie();
  cookies().set(c.name, c.value, c.options);
  // Derive base from the incoming request so this works on whatever host
  // the app is actually deployed under (Container Apps FQDN, custom domain,
  // localhost in dev, etc.). Honor x-forwarded-* if the platform sets them.
  const fwdHost = req.headers.get('x-forwarded-host');
  const fwdProto = req.headers.get('x-forwarded-proto');
  const base =
    fwdHost && fwdProto
      ? `${fwdProto}://${fwdHost}`
      : new URL(req.url).origin;
  return NextResponse.redirect(new URL('/login', base));
}
