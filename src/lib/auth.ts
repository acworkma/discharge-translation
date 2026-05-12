import { cookies } from 'next/headers';
import crypto from 'node:crypto';

const COOKIE = 'dt_session';
const SECRET = () => process.env.SESSION_SECRET || 'dev-secret-change-me';
const PASSWORD = () => process.env.APP_PASSWORD || 'fr24';

function sign(value: string): string {
  return crypto.createHmac('sha256', SECRET()).update(value).digest('hex');
}

export function createSessionCookie(): { name: string; value: string; options: any } {
  const issued = Date.now().toString();
  const sig = sign(issued);
  return {
    name: COOKIE,
    value: `${issued}.${sig}`,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
      maxAge: 60 * 60 * 8 // 8h
    }
  };
}

export function clearSessionCookie() {
  return { name: COOKIE, value: '', options: { path: '/', maxAge: 0 } };
}

export function isAuthenticated(): boolean {
  const c = cookies().get(COOKIE)?.value;
  if (!c) return false;
  const [issued, sig] = c.split('.');
  if (!issued || !sig) return false;
  return sign(issued) === sig;
}

export function verifyPassword(input: string): boolean {
  const expected = PASSWORD();
  if (input.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(input), Buffer.from(expected));
}
