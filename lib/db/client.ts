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

const sql = globalThis.__notebooklmSql ?? createClient();
if (process.env.NODE_ENV !== "production") {
  globalThis.__notebooklmSql = sql;
}

export const db = drizzle(sql);
export { sql };
