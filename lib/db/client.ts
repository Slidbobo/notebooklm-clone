import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { serverEnv } from "@/lib/env";

/**
 * Raw database handle.
 *
 * INTERNAL. Do not import this outside of `lib/db/`. Every application read or
 * write goes through the tenant-scoped access layer, which requires a UserId in
 * its type signature. An ESLint rule enforces the import boundary; see
 * eslint.config.mjs.
 *
 * Driver choice: postgres.js over TCP rather than the Neon serverless driver.
 * The Neon driver only speaks to Neon's HTTP/WS proxy, which would make the
 * access-control tests impossible to run against the plain pgvector container
 * used in CI. One driver for both environments keeps the tests honest.
 *
 * Connections are opened on first use, never at module evaluation. Next.js
 * imports route modules while collecting page data at build time, where no
 * database credentials exist; a connection created at import time fails the
 * build. Lazy initialisation also keeps cold starts from dialling out for
 * requests that never touch the database.
 */
declare global {
  // Reused across hot reloads in development so we do not leak connections.
  var __notebooklmSql: ReturnType<typeof postgres> | undefined;
}

function createClient() {
  return postgres(serverEnv().DATABASE_URL, {
    // Neon's pooled endpoint runs PgBouncer in transaction mode, which does not
    // support the extended protocol's prepared statements.
    prepare: false,
    max: 5,
    idle_timeout: 20,
  });
}

export function getSql() {
  globalThis.__notebooklmSql ??= createClient();
  return globalThis.__notebooklmSql;
}

export function getDb() {
  return drizzle(getSql());
}

/** Closes the pool. Used by tests; the serverless runtime tears itself down. */
export async function closeDb() {
  const existing = globalThis.__notebooklmSql;
  if (!existing) return;
  globalThis.__notebooklmSql = undefined;
  await existing.end({ timeout: 5 });
}
