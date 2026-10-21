import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { CH } from "./db";
import { queryRows } from "./db";
import { chTimestamp } from "./transform";

export interface SiteRecord {
  id: string;
  name: string;
  url: string;
  keyHash: string;
  keyHint: string;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
}

export const SITE_KEY_RE = /^pt_[0-9a-f]{40}$/;

export function generateSiteKey(): string {
  return `pt_${randomBytes(20).toString("hex")}`;
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function keyHint(key: string): string {
  return `${key.slice(0, 7)}...${key.slice(-4)}`;
}

export class SiteInputError extends Error {}

export function validateSiteInput(input: unknown): { name: string; url: string } {
  if (typeof input !== "object" || input === null) throw new SiteInputError("Expected a JSON object.");
  const { name, url } = input as Record<string, unknown>;
  if (typeof name !== "string" || name.trim().length < 1 || name.trim().length > 100) {
    throw new SiteInputError("Name is required and must be at most 100 characters.");
  }
  if (typeof url !== "string" || url.trim() === "") throw new SiteInputError("URL is required.");
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new SiteInputError("URL must be a full address such as https://example.com.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SiteInputError("URL must start with http:// or https://.");
  }
  if (parsed.username || parsed.password) throw new SiteInputError("URL must not contain credentials.");
  return { name: name.trim(), url: `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}` };
}

interface SiteDbRow {
  id: string;
  name: string;
  url: string;
  key_hash: string;
  key_hint: string;
  created_at: number;
  updated_at: number;
  deleted: number;
}

/** Persistence port so the store can be tested without ClickHouse. */
export interface SiteRepo {
  loadAll(): Promise<SiteRecord[]>;
  save(site: SiteRecord): Promise<void>;
}

export function clickhouseSiteRepo(ch: CH): SiteRepo {
  return {
    async loadAll() {
      const rows = await queryRows<SiteDbRow>(
        ch,
        `SELECT id, name, url, key_hash, key_hint,
          toUnixTimestamp64Milli(created_at) AS created_at,
          toUnixTimestamp64Milli(updated_at) AS updated_at, deleted
        FROM sites FINAL`,
      );
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        url: r.url,
        keyHash: r.key_hash,
        keyHint: r.key_hint,
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at),
        deleted: Number(r.deleted) === 1,
      }));
    },
    async save(site) {
      await ch.insert({
        table: "sites",
        format: "JSONEachRow",
        values: [
          {
            id: site.id,
            name: site.name,
            url: site.url,
            key_hash: site.keyHash,
            key_hint: site.keyHint,
            created_at: chTimestamp(site.createdAt),
            updated_at: chTimestamp(site.updatedAt),
            deleted: site.deleted ? 1 : 0,
          },
        ],
      });
    },
  };
}

/**
 * Sites with an in-memory cache keyed by the SHA-256 of the site key. The cache
 * is updated on every change made through this store and refreshed periodically.
 */
export class SiteStore {
  private byId = new Map<string, SiteRecord>();
  private byHash = new Map<string, SiteRecord>();
  private timer: NodeJS.Timeout | null = null;
  private lastUpdate = 0;
  /** Bumped after every change made through this store, so a refresh that read older data is discarded. */
  private generation = 0;

  constructor(private readonly repo: SiteRepo) {}

  async refresh(): Promise<void> {
    const started = this.generation;
    const loaded = await this.repo.loadAll();
    // A create, rotate, update or remove finished while the query ran: the snapshot may predate it, so keep
    // the cache (which already has the change) and let the next refresh pick up anything else.
    if (this.generation !== started) return;
    const latest = new Map<string, SiteRecord>();
    for (const s of loaded) {
      const prev = latest.get(s.id);
      if (!prev || s.updatedAt >= prev.updatedAt) latest.set(s.id, s);
    }
    const byId = new Map<string, SiteRecord>();
    const byHash = new Map<string, SiteRecord>();
    for (const s of latest.values()) {
      if (s.deleted) continue;
      byId.set(s.id, s);
      byHash.set(s.keyHash, s);
      this.lastUpdate = Math.max(this.lastUpdate, s.updatedAt);
    }
    this.byId = byId;
    this.byHash = byHash;
  }

  startAutoRefresh(intervalMs = 60_000, log: (msg: string) => void = console.error): void {
    this.timer = setInterval(() => {
      this.refresh().catch((e: unknown) => log(`Site cache refresh failed: ${e instanceof Error ? e.message : String(e)}`));
    }, intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  list(): SiteRecord[] {
    return [...this.byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id: string): SiteRecord | undefined {
    return this.byId.get(id);
  }

  findByKey(key: string): SiteRecord | undefined {
    if (!SITE_KEY_RE.test(key)) return undefined;
    return this.byHash.get(hashKey(key));
  }

  /** Strictly increasing timestamps so ReplacingMergeTree keeps the latest version. */
  private now(): number {
    this.lastUpdate = Math.max(Date.now(), this.lastUpdate + 1);
    return this.lastUpdate;
  }

  async create(input: { name: string; url: string }): Promise<{ site: SiteRecord; key: string }> {
    const key = generateSiteKey();
    const now = this.now();
    const site: SiteRecord = {
      id: randomUUID(),
      name: input.name,
      url: input.url,
      keyHash: hashKey(key),
      keyHint: keyHint(key),
      createdAt: now,
      updatedAt: now,
      deleted: false,
    };
    await this.repo.save(site);
    this.byId.set(site.id, site);
    this.byHash.set(site.keyHash, site);
    this.generation++;
    return { site, key };
  }

  async rotate(id: string): Promise<{ site: SiteRecord; key: string } | undefined> {
    const current = this.byId.get(id);
    if (!current) return undefined;
    const key = generateSiteKey();
    const site: SiteRecord = { ...current, keyHash: hashKey(key), keyHint: keyHint(key), updatedAt: this.now() };
    await this.repo.save(site);
    this.byHash.delete(current.keyHash);
    this.byId.set(id, site);
    this.byHash.set(site.keyHash, site);
    this.generation++;
    return { site, key };
  }

  async update(id: string, input: { name: string; url: string }): Promise<SiteRecord | undefined> {
    const current = this.byId.get(id);
    if (!current) return undefined;
    const site: SiteRecord = { ...current, name: input.name, url: input.url, updatedAt: this.now() };
    await this.repo.save(site);
    this.byId.set(id, site);
    this.byHash.set(site.keyHash, site);
    this.generation++;
    return site;
  }

  async remove(id: string): Promise<boolean> {
    const current = this.byId.get(id);
    if (!current) return false;
    await this.repo.save({ ...current, deleted: true, updatedAt: this.now() });
    this.byId.delete(id);
    this.byHash.delete(current.keyHash);
    this.generation++;
    return true;
  }
}
