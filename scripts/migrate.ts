import { config } from "dotenv";

config({ path: ".env.local" });

import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

/**
 * Applies pending migrations under an advisory lock.
 *
 * Migrations run as part of the build, so two builds that overlap, a git push
 * and a manual deploy for instance, would otherwise migrate the same database at
 * the same time. That is not hypothetical: it failed a production deploy on the
 * first attempt, with one build erroring out mid-migration while the other
 * succeeded.
 *
 * pg_advisory_lock serialises them. The second build blocks until the first is
 * done, then finds nothing left to apply and continues. The lock lives in
 * Postgres itself, so no extra infrastructure is involved, and it is released
 * automatically if the connection dies.
 */
// pg_advisory_lock has a two-int variant, which avoids passing a bigint through
// the driver. The pair is arbitrary but fixed: any process using the same two
// numbers contends for the same lock.
const LOCK_NAMESPACE = 0x6e6c_6d63;
const LOCK_KEY = 1;

// DDL runs in a transaction and cannot go through PgBouncer in transaction mode.
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error("Missing environment variable: DATABASE_URL_UNPOOLED or DATABASE_URL");
}

async function main() {
  const sql = postgres(url!, { max: 1 });
  try {
    await sql`SELECT pg_advisory_lock(${LOCK_NAMESPACE}, ${LOCK_KEY})`;
    try {
      await migrate(drizzle(sql), { migrationsFolder: "drizzle" });
      console.log("migrations applied");
    } finally {
      await sql`SELECT pg_advisory_unlock(${LOCK_NAMESPACE}, ${LOCK_KEY})`;
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("Migration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
