/** Keeps the latest draft dirty until its write is acknowledged. */
export class DraftSaver<T> {
  pending: T | null = null;
  private active: Promise<boolean> | null = null;

  constructor(
    private readonly save: (draft: T) => Promise<void>,
    private readonly onError: (error: unknown | null) => void,
  ) {}

  flush(): Promise<boolean> {
    if (this.active) return this.active;
    // Defer the drain so active is installed even if save throws synchronously.
    const operation = Promise.resolve().then(async () => {
      while (this.pending !== null) {
        const draft = this.pending;
        try {
          await this.save(draft);
          if (this.pending === draft) this.pending = null;
          this.onError(null);
        } catch (error) {
          // Keep either this failed payload or a newer complete draft for retry.
          this.onError(error);
          return false;
        }
      }
      return true;
    }).finally(() => {
      if (this.active === operation) this.active = null;
    });
    this.active = operation;
    return operation;
  }
}
