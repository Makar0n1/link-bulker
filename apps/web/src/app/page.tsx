'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';

interface MeResponse {
  user: { id: string; email: string; role: 'ADMIN' | 'USER' };
}

export default function Home() {
  const router = useRouter();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api<MeResponse>('/auth/me'),
    retry: false,
  });

  useEffect(() => {
    if (me.isSuccess) router.replace('/projects');
    if (me.isError && me.error instanceof ApiError && me.error.status === 401) {
      router.replace('/login');
    }
  }, [me.isSuccess, me.isError, me.error, router]);

  return (
    <main className="flex min-h-screen items-center justify-center text-neutral-500">
      Loading…
    </main>
  );
}
