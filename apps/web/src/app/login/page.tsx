'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';

interface LoginResponse {
  user: { id: string; email: string; role: 'ADMIN' | 'USER' };
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const login = useMutation({
    mutationFn: (vars: { email: string; password: string }) =>
      api<LoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify(vars) }),
    onSuccess: () => router.replace('/projects'),
    onError: (err) => {
      if (err instanceof ApiError) {
        setError(err.status === 401 ? 'Invalid email or password' : err.message);
      } else {
        setError('Network error');
      }
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    login.mutate({ email, password });
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center px-4">
      {/* Subtle background gradient */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-neutral-50 via-white to-neutral-100 dark:from-neutral-950 dark:via-neutral-950 dark:to-neutral-900"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/3 -z-0 h-72 w-72 -translate-x-1/2 rounded-full bg-neutral-200/40 blur-3xl dark:bg-neutral-800/40"
      />

      <form onSubmit={onSubmit} className="card relative w-full max-w-sm space-y-5 p-7 animate-fade-in">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-neutral-900 text-sm font-bold text-white dark:bg-white dark:text-neutral-900">
              LC
            </span>
            <h1 className="text-lg font-semibold heading">Link Checker</h1>
          </div>
          <p className="text-sm muted">Sign in to your dashboard.</p>
        </div>

        <div className="space-y-2">
          <label className="label">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="admin@example.com"
            className="input"
          />
        </div>

        <div className="space-y-2">
          <label className="label">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="••••••••"
            className="input"
          />
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200/60 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900/60 animate-fade-in">
            {error}
          </div>
        )}

        <button type="submit" disabled={login.isPending} className="btn-primary w-full">
          {login.isPending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  );
}
