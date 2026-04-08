import { describe, expect, it } from 'vitest';
import { CircuitBreaker, CircuitOpenError } from '../src/circuit-breaker';

describe('CircuitBreaker', () => {
  it('starts CLOSED and passes successful calls', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
    expect(cb.getState()).toBe('CLOSED');
    expect(await cb.exec(async () => 42)).toBe(42);
    expect(cb.getState()).toBe('CLOSED');
  });

  it('opens after N consecutive failures', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });

    for (let i = 0; i < 3; i++) {
      await expect(cb.exec(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    }

    expect(cb.getState()).toBe('OPEN');

    // Next call fails fast
    await expect(cb.exec(async () => 1)).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it('resets failure counter on a successful call', async () => {
    const cb = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });

    await expect(cb.exec(async () => Promise.reject(new Error('x')))).rejects.toThrow();
    await expect(cb.exec(async () => Promise.reject(new Error('x')))).rejects.toThrow();
    expect(cb.getState()).toBe('CLOSED');

    await cb.exec(async () => 'ok');
    // Two more failures should NOT open it because counter reset
    await expect(cb.exec(async () => Promise.reject(new Error('x')))).rejects.toThrow();
    await expect(cb.exec(async () => Promise.reject(new Error('x')))).rejects.toThrow();
    expect(cb.getState()).toBe('CLOSED');
  });

  it('transitions OPEN → HALF_OPEN after cooldown, then CLOSED on success', async () => {
    let now = 1_000_000;
    const cb = new CircuitBreaker({
      failureThreshold: 2,
      cooldownMs: 500,
      now: () => now,
    });

    await expect(cb.exec(async () => Promise.reject(new Error('x')))).rejects.toThrow();
    await expect(cb.exec(async () => Promise.reject(new Error('x')))).rejects.toThrow();
    expect(cb.getState()).toBe('OPEN');

    // Advance virtual clock past cooldown
    now += 600;
    expect(cb.getState()).toBe('HALF_OPEN');

    // Probe call succeeds → CLOSED
    await cb.exec(async () => 'ok');
    expect(cb.getState()).toBe('CLOSED');
  });

  it('HALF_OPEN failure goes back to OPEN', async () => {
    let now = 1_000_000;
    const cb = new CircuitBreaker({
      failureThreshold: 1,
      cooldownMs: 500,
      now: () => now,
    });

    await expect(cb.exec(async () => Promise.reject(new Error('x')))).rejects.toThrow();
    expect(cb.getState()).toBe('OPEN');

    now += 600;
    expect(cb.getState()).toBe('HALF_OPEN');

    await expect(cb.exec(async () => Promise.reject(new Error('x')))).rejects.toThrow();
    expect(cb.getState()).toBe('OPEN');
  });
});
