import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import { isAuthenticated } from '@/lib/auth';

export const metadata: Metadata = {
  title: 'Discharge Translation Lab',
  description: 'Compare clinical document translation methods'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const authed = isAuthenticated();
  return (
    <html lang="en">
      <body className="min-h-screen flex flex-col">
        <header className="bg-brand text-white shadow">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
            <Link href="/" className="font-semibold tracking-tight text-lg">
              Discharge Translation Lab
            </Link>
            <nav className="flex items-center gap-4 text-sm">
              {authed && (
                <>
                  <Link href="/dashboard" className="hover:underline">Dashboard</Link>
                  <Link href="/upload" className="hover:underline">New Run</Link>
                  <form action="/api/auth/logout" method="post">
                    <button className="hover:underline" type="submit">Logout</button>
                  </form>
                </>
              )}
            </nav>
          </div>
        </header>
        <main className="flex-1 max-w-6xl w-full mx-auto px-4 py-6">{children}</main>
        <footer className="text-xs text-slate-500 text-center py-4">
          Stub build &mdash; PHI-safe defaults active. Do not log document text.
        </footer>
      </body>
    </html>
  );
}
