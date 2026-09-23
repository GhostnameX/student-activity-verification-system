import { isIP } from "node:net";

export interface LoginRateLimitOptions {
  accountLimit: number;
  ipLimit: number;
  windowMs: number;
  maxEntries: number;
  now?: () => number;
}

interface AttemptBucket {
  failures: number;
  resetAt: number;
}

export interface LoginRateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function resolveLoginClientIp(options: {
  isRender: boolean;
  forwardedFor?: string | null;
  socketAddress?: string | null;
}): string | undefined {
  if (options.isRender && options.forwardedFor) {
    const firstHop = options.forwardedFor.split(",", 1)[0]?.trim();
    if (firstHop && isIP(firstHop) !== 0) return firstHop;
  }

  const socketAddress = options.socketAddress?.trim();
  return socketAddress && isIP(socketAddress) !== 0 ? socketAddress : undefined;
}

export class LoginRateLimiter {
  private readonly accountAttempts = new Map<string, AttemptBucket>();
  private readonly ipAttempts = new Map<string, AttemptBucket>();
  private readonly now: () => number;

  constructor(private readonly options: LoginRateLimitOptions) {
    this.now = options.now ?? Date.now;
  }

  consumeAttempt(staffCode: string, ip?: string): LoginRateLimitResult {
    const now = this.now();
    this.deleteExpired(this.accountAttempts, now);
    this.deleteExpired(this.ipAttempts, now);

    const account = this.accountAttempts.get(staffCode);
    const address = ip ? this.ipAttempts.get(ip) : undefined;
    const accountBlocked = account && account.failures >= this.options.accountLimit;
    const ipBlocked = address && address.failures >= this.options.ipLimit;
    const resetAt = Math.max(
      accountBlocked ? account.resetAt : 0,
      ipBlocked ? address.resetAt : 0,
    );

    if (accountBlocked || ipBlocked) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
      };
    }

    this.increment(this.accountAttempts, staffCode, now);
    if (ip) this.increment(this.ipAttempts, ip, now);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  recordSuccess(staffCode: string, ip?: string): void {
    this.accountAttempts.delete(staffCode);
    if (!ip) return;
    const address = this.ipAttempts.get(ip);
    if (!address) return;
    if (address.failures <= 1) this.ipAttempts.delete(ip);
    else address.failures -= 1;
  }

  private increment(store: Map<string, AttemptBucket>, key: string, now: number): void {
    const current = store.get(key);
    if (current && current.resetAt > now) {
      current.failures += 1;
      return;
    }

    this.ensureCapacity(store, now);
    store.set(key, { failures: 1, resetAt: now + this.options.windowMs });
  }

  private ensureCapacity(store: Map<string, AttemptBucket>, now: number): void {
    this.deleteExpired(store, now);
    while (store.size >= this.options.maxEntries) {
      const oldest = store.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
  }

  private deleteExpired(store: Map<string, AttemptBucket>, now: number): void {
    for (const [key, bucket] of store) {
      if (bucket.resetAt <= now) store.delete(key);
    }
  }
}
