/** Token bucket per key: `ratePerSecond` tokens refill each second, up to `burst`. A rate of 0 turns it off. */
export class TokenBucketLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();

  constructor(
    private readonly ratePerSecond: number,
    private readonly burst: number,
  ) {}

  /** Takes one token. Returns 0 when allowed, else the seconds until the next token. */
  take(key: string, now: number = Date.now()): number {
    if (this.ratePerSecond <= 0) return 0;
    const capacity = Math.max(1, this.burst);
    const bucket = this.buckets.get(key) ?? { tokens: capacity, at: now };
    bucket.tokens = Math.min(capacity, bucket.tokens + ((now - bucket.at) / 1000) * this.ratePerSecond);
    bucket.at = now;
    this.buckets.set(key, bucket);
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return 0;
    }
    if (this.buckets.size > 10_000) this.prune(now);
    return Math.max(1, Math.ceil((1 - bucket.tokens) / this.ratePerSecond));
  }

  private prune(now: number): void {
    const full = (Math.max(1, this.burst) / this.ratePerSecond) * 1000;
    for (const [key, b] of this.buckets) if (now - b.at > full) this.buckets.delete(key);
  }
}
