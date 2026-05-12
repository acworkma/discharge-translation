'use client';
import { useState } from 'react';

export default function LoginPage() {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    });
    setLoading(false);
    if (res.ok) window.location.href = '/dashboard';
    else setErr('Invalid password');
  }

  return (
    <div className="max-w-sm mx-auto mt-20 bg-white shadow rounded-lg p-6">
      <h1 className="text-xl font-semibold mb-4">Sign in</h1>
      <form onSubmit={onSubmit} className="space-y-4">
        <input
          type="password"
          autoFocus
          placeholder="Password"
          className="w-full border rounded px-3 py-2"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
        />
        {err && <p className="text-red-600 text-sm">{err}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-brand text-white rounded py-2 hover:bg-brand-dark disabled:opacity-50"
        >
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
