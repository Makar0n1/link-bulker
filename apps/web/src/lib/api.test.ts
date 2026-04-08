import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';

describe('api fetch wrapper', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('does NOT set Content-Type when there is no body', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await api('/auth/me');
    const init = (globalThis.fetch as any).mock.calls[0][1];
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(init.credentials).toBe('include');
  });

  it('sets Content-Type: application/json when body is present', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await api('/projects', { method: 'POST', body: JSON.stringify({ name: 'X' }) });
    const init = (globalThis.fetch as any).mock.calls[0][1];
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('throws ApiError with status and parsed body on non-2xx', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'nope', extra: 1 }), { status: 401 }),
    );
    await expect(api('/auth/me')).rejects.toMatchObject({
      status: 401,
      message: 'nope',
    });
  });

  it('throws ApiError on 429 with retryAfterSec in details', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(
      new Response(
        JSON.stringify({ message: 'Recheck cooldown active', retryAfterSec: 42 }),
        { status: 429 },
      ),
    );
    try {
      await api('/links/x/check', { method: 'POST' });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(429);
      expect((apiErr.details as any).retryAfterSec).toBe(42);
    }
  });

  it('returns parsed JSON on 2xx', async () => {
    (globalThis.fetch as any).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: '1', name: 'p' }), { status: 200 }),
    );
    const result = await api<{ id: string }>('/projects/1');
    expect(result).toEqual({ id: '1', name: 'p' });
  });
});
