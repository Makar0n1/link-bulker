/**
 * In-process circuit breaker.
 *
 * State machine:
 *   CLOSED  → calls pass through. On consecutive failures >= threshold → OPEN.
 *   OPEN    → calls fail fast with CircuitOpenError until cooldownMs elapses.
 *             First call after cooldown is allowed in HALF_OPEN.
 *   HALF_OPEN → one trial call in flight. Success → CLOSED, failure → OPEN.
 *
 * In-process is intentional: each worker observes its own provider health.
 * A distributed CB would couple replicas and add a SPOF without benefit
 * for our scale.
 */

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerOptions {
  /** Consecutive failures that flip CLOSED → OPEN. Default 5. */
  failureThreshold?: number;
  /** How long to stay OPEN before allowing a probe (ms). Default 30_000. */
  cooldownMs?: number;
  /** Optional clock for tests. */
  now?: () => number;
}

export class CircuitOpenError extends Error {
  constructor(message = 'Circuit is OPEN') {
    super(message);
    this.name = 'CircuitOpenError';
  }
}

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private openedAt = 0;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.cooldownMs = options.cooldownMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  getState(): CircuitState {
    if (this.state === 'OPEN' && this.now() - this.openedAt >= this.cooldownMs) {
      this.state = 'HALF_OPEN';
    }
    return this.state;
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    const state = this.getState();
    if (state === 'OPEN') {
      throw new CircuitOpenError();
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    this.state = 'CLOSED';
  }

  private onFailure(): void {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= this.failureThreshold || this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      this.openedAt = this.now();
    }
  }

  /** Reset to a clean CLOSED state. Tests use this; runtime usually doesn't. */
  reset(): void {
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.openedAt = 0;
  }
}
