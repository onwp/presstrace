import { z } from "zod";

export const MAX_DECOMPRESSED_BYTES = 2 * 1024 * 1024;
export const MAX_TRANSACTIONS = 50;
export const MAX_SPANS = 500;
export const SQL_MAX_CHARS = 2000;

const ms = z.number().finite().min(0).max(86_400_000);
const shortText = (max: number) => z.string().max(max);
const nullableText = (max: number) => z.string().max(max).nullable().optional();
const component = z
  .string()
  .max(200)
  .regex(/^(core|unknown|(plugin|mu-plugin|theme|dropin):[^\s]{1,190})$/, "invalid component");
const stack = z.array(z.string().max(1000)).max(15).nullable().optional();

const base = {
  name: shortText(500),
  start: ms,
  duration: ms,
  component,
};

const dbSpan = z.object({
  kind: z.literal("db"),
  ...base,
  // The agent truncates to 2000 chars; leave room for multi-byte truncation differences.
  sql: z.string().min(1).max(SQL_MAX_CHARS * 2),
  rows: z.number().int().min(-1).nullable().optional(),
  error: nullableText(2000),
  stack,
});

const httpSpan = z.object({
  kind: z.literal("http"),
  ...base,
  url: z.string().min(1).max(2000),
  method: z.string().min(1).max(16).regex(/^[A-Za-z]+$/),
  status: z.number().int().min(0).max(999).nullable().optional(),
  error: nullableText(2000),
  stack,
});

const callbackSpan = z.object({
  kind: z.literal("callback"),
  ...base,
  self: ms.optional(),
  hook: shortText(300),
  file: nullableText(500),
});

const loadSpan = z.object({
  kind: z.enum(["plugin_load", "theme_load"]),
  ...base,
});

export const spanSchema = z.discriminatedUnion("kind", [dbSpan, httpSpan, callbackSpan, loadSpan]);

export const errorSchema = z.object({
  level: z.enum(["fatal", "error", "warning", "notice", "deprecated", "exception"]),
  message: z.string().max(4000),
  file: nullableText(500),
  line: z.number().int().min(0).nullable().optional(),
  component,
});

const transactionSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{16,64}$/i, "id must be 16 to 64 hex chars"),
  ts: z
    .number()
    .int()
    .min(1_500_000_000_000)
    .max(4_102_444_800_000),
  name: z.string().min(1).max(300),
  type: z.enum(["frontend", "admin", "rest", "ajax", "cron", "cli"]),
  method: z.string().max(16).regex(/^[A-Za-z]*$/),
  url: z.string().max(2000),
  status: z.number().int().min(0).max(999),
  duration: ms,
  db_time: ms,
  db_count: z.number().int().min(0).max(10_000_000),
  http_time: ms,
  http_count: z.number().int().min(0).max(1_000_000),
  memory_peak_mb: z.number().finite().min(0).max(1_000_000),
  sample_rate: z.number().finite().min(0).max(1),
  user_logged_in: z.boolean(),
  spans: z.array(spanSchema).max(MAX_SPANS),
  components: z
    .array(
      z.object({
        component,
        time: ms,
        calls: z.number().int().min(0).max(100_000_000),
      }),
    )
    .max(500),
  errors: z.array(errorSchema).max(200),
  dropped_spans: z.number().int().min(0).max(100_000_000),
});

export const payloadSchema = z.object({
  v: z.literal(1),
  agent: z.string().min(1).max(50),
  env: z.object({
    php: z.string().max(50),
    wp: z.string().max(50),
    memory_limit_mb: z.number().int().min(-1).max(1_000_000),
    object_cache: z.boolean(),
    db_capture: z.string().max(30),
  }),
  transactions: z.array(transactionSchema).min(1).max(MAX_TRANSACTIONS),
});

export type Payload = z.infer<typeof payloadSchema>;
export type PayloadTransaction = Payload["transactions"][number];
export type PayloadSpan = z.infer<typeof spanSchema>;
export type PayloadError = z.infer<typeof errorSchema>;

export type ValidationResult = { ok: true; payload: Payload } | { ok: false; errors: string[] };

export function validatePayload(input: unknown): ValidationResult {
  const parsed = payloadSchema.safeParse(input);
  if (parsed.success) return { ok: true, payload: parsed.data };
  return {
    ok: false,
    errors: parsed.error.issues.slice(0, 20).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}

/** How far ahead of the server clock a transaction timestamp may be. */
export const MAX_FUTURE_MS = 3600 * 1000;

/**
 * Keeps transactions whose timestamp lies in [now - maxAgeMs, now + 1 hour]. Rows outside that window would
 * expire at once or sit in a far-future partition that TTL never drops, so they are not stored.
 */
export function withinTimeWindow(payload: Payload, now: number, maxAgeMs: number): { payload: Payload; rejected: number } {
  const from = now - maxAgeMs;
  const to = now + MAX_FUTURE_MS;
  const kept = payload.transactions.filter((t) => t.ts >= from && t.ts <= to);
  return { payload: { ...payload, transactions: kept }, rejected: payload.transactions.length - kept.length };
}
