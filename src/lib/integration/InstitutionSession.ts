import type { User } from '../repositories/interfaces';

/** A sign-out invalidates work even when the next sign-in uses the same subject. */
export class InstitutionSession {
  private generation = 0;
  private revoked = false;
  principalId: string | null = null;
  private subscriptions = new Set<() => void>();

  constructor(private readonly readProvider: () => Promise<User | null>) {}

  get isRevoked(): boolean { return this.revoked; }
  capture(): number { return this.generation; }
  isCurrent(generation: number): boolean { return !this.revoked && generation === this.generation; }
  assertCurrent(generation: number): void {
    if (!this.isCurrent(generation)) throw new Error('The authenticated session changed. Sign in again before continuing.');
  }

  async getUser(): Promise<User | null> {
    if (this.revoked) return null;
    const generation = this.generation;
    const user = await this.readProvider();
    this.assertCurrent(generation);
    this.principalId = user?.id ?? this.principalId;
    return user;
  }

  revoke(): void {
    this.revoked = true;
    this.generation += 1;
    for (const dispose of this.subscriptions) {
      try { dispose(); } catch { /* Revocation must finish even if a provider cleanup fails. */ }
    }
    this.subscriptions.clear();
  }

  activate(generation: number): void {
    if (generation !== this.generation) throw new Error('The authenticated session changed during sign-in.');
    this.revoked = false;
    this.generation += 1;
  }

  /** Preserve each repository contract while rejecting results from older sessions. */
  guard<T extends object>(repository: T, subscriptionErrorIndexes: Partial<Record<keyof T, number>> = {}): T {
    return new Proxy(repository, {
      get: (target, key, receiver) => {
        const method: unknown = Reflect.get(target, key, receiver);
        if (typeof method !== 'function') return method;
        return (...args: unknown[]) => {
          const generation = this.capture();
          if (!this.isCurrent(generation)) {
            const error = new Error('The authenticated session changed. Sign in again before continuing.');
            const errorIndex = subscriptionErrorIndexes[key as keyof T];
            if (errorIndex !== undefined) {
              const onError = args[errorIndex];
              if (typeof onError === 'function') queueMicrotask(() => Reflect.apply(onError, undefined, [error]));
              return () => undefined;
            }
            return Promise.reject(error);
          }
          const guardedArgs = args.map(arg => typeof arg === 'function'
            ? (...values: unknown[]) => { if (this.isCurrent(generation)) Reflect.apply(arg, undefined, values); }
            : arg);
          const result: unknown = Reflect.apply(method, target, guardedArgs);
          if (result instanceof Promise) return result.then(value => { this.assertCurrent(generation); return value; });
          if (typeof result === 'function') {
            const dispose = () => { this.subscriptions.delete(dispose); Reflect.apply(result, undefined, []); };
            this.subscriptions.add(dispose);
            return dispose;
          }
          return result;
        };
      },
    });
  }
}
