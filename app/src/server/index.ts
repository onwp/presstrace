import { serve } from "@hono/node-server";
import { ConfigError, insecurePublicUrl, loadConfig, trustProxyExposed } from "./config";
import { connect, setClickHouseLogger, waitForClickHouse } from "./db";
import { migrate } from "./migrations";
import { SiteStore, clickhouseSiteRepo } from "./sites";
import { Batcher, clickhouseInserter } from "./batcher";
import { Reports } from "./reports";
import { createApp } from "./app";
import { SessionRevocations, clickhouseRevocationRepo } from "./auth";
import { createLogger, describeError } from "./log";
import { installProcessHandlers } from "./process";

const log = createLogger();
installProcessHandlers(process, log, (code) => process.exit(code));

/** How long shutdown waits for open requests, then for the final flush. Compose allows 30 s in total. */
const CLOSE_DEADLINE_MS = 10_000;
const FLUSH_DEADLINE_MS = 15_000;

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      // Plain text on purpose: this is the list of settings to fix, read by a person at the terminal.
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
  setClickHouseLogger(log);
  if (insecurePublicUrl(config.publicUrl)) {
    log.warn(
      "PUBLIC_URL uses plain http on a non-local host. Passwords, session cookies and site keys then cross the network unencrypted. Put HTTPS in front of the app and set PUBLIC_URL to the https:// address.",
      { publicUrl: config.publicUrl },
    );
  }
  if (trustProxyExposed(config)) {
    log.warn(
      "TRUST_PROXY is on and the app is reachable on all interfaces. Clients that skip the proxy can set X-Forwarded-For and dodge the login limit. Publish the app on 127.0.0.1 (APP_BIND) behind the proxy.",
    );
  }

  log.info("Waiting for ClickHouse", { url: config.clickhouse.url });
  await waitForClickHouse(config.clickhouse);
  const ch = await connect(config.clickhouse);
  await migrate(ch, { transactionsTtlDays: config.transactionsTtlDays, spansTtlDays: config.spansTtlDays }, (msg) =>
    log.info(msg),
  );

  const sites = new SiteStore(clickhouseSiteRepo(ch));
  await sites.refresh();
  sites.startAutoRefresh(60_000, (msg) => log.error(msg));

  const revocations = new SessionRevocations(clickhouseRevocationRepo(ch));
  await revocations.load();

  const batcher = new Batcher(clickhouseInserter(ch), { maxBufferedBytes: config.bufferMaxBytes, log });
  batcher.start();

  const app = createApp({
    config,
    sites,
    sink: batcher,
    reports: new Reports(ch),
    health: async () => (await ch.ping()).success,
    revocations,
    log,
  });

  const server = serve({ fetch: app.fetch, port: config.port, hostname: config.host }, (info) => {
    log.info(`Listening on http://${info.address}:${info.port}`, { publicUrl: config.publicUrl });
  });

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log.info(`${signal} received, finishing open requests and flushing buffered rows`);
    // Stop accepting connections and let open requests finish, up to a deadline.
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        const s = server as unknown as { closeAllConnections?: () => void };
        s.closeAllConnections?.();
        resolve();
      }, CLOSE_DEADLINE_MS);
      server.close(() => {
        clearTimeout(timer);
        resolve();
      });
      const s = server as unknown as { closeIdleConnections?: () => void };
      s.closeIdleConnections?.();
    });
    sites.stop();
    try {
      const left = await batcher.stop(FLUSH_DEADLINE_MS);
      if (left > 0) log.error("Shutdown deadline reached, buffered rows were not written", { rows: left });
    } catch (error) {
      log.error("Final flush failed", { reason: describeError(error) });
    }
    await ch.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  log.error("Startup failed", { reason: describeError(error) });
  process.exit(1);
});
