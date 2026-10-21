import type { LogFields, Logger } from "./log";

export type SecurityEvent =
  | "login_success"
  | "login_failure"
  | "login_locked"
  | "logout"
  | "site_create"
  | "site_update"
  | "site_key_rotate"
  | "site_delete"
  | "bad_site_key"
  | "session_rejected"
  | "cross_origin_refused";

const WARN_EVENTS = new Set<SecurityEvent>(["login_failure", "login_locked", "bad_site_key", "session_rejected", "cross_origin_refused"]);

/**
 * Writes one JSON line per security event: {"msg":"security event","security":true,"event":"...", ...}.
 * Callers pass ids and addresses only, never passwords, cookies or site keys.
 */
export function securityEvent(log: Logger, event: SecurityEvent, fields: LogFields = {}): void {
  const entry = { security: true, event, ...fields };
  if (WARN_EVENTS.has(event)) log.warn("security event", entry);
  else log.info("security event", entry);
}

/**
 * Counts repeated failures of one kind (a wrong site key, a rejected session cookie, a cross-origin request) per
 * client address. The first failure of a window is reported; the next report, when a new window starts, carries
 * how many failures the previous window had. This keeps key guessing, token tampering or a misconfigured agent
 * visible without one log line per request.
 */
export class FailureTracker {
  private windows = new Map<string, { start: number; count: number }>();

  constructor(private readonly windowMs = 60_000) {}

  record(client: string, now: number = Date.now()): { report: boolean; count: number; previous?: number } {
    const w = this.windows.get(client);
    if (!w || now - w.start >= this.windowMs) {
      this.windows.set(client, { start: now, count: 1 });
      if (this.windows.size > 10_000) this.prune(now);
      return w ? { report: true, count: 1, previous: w.count } : { report: true, count: 1 };
    }
    w.count++;
    return { report: false, count: w.count };
  }

  private prune(now: number): void {
    for (const [k, w] of this.windows) if (now - w.start >= this.windowMs) this.windows.delete(k);
  }
}
