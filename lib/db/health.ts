import { getSql } from "@/lib/db/client";

export type DatabaseHealth = {
  database: boolean;
  pgvector: boolean;
};

/**
 * Connectivity probe. Lives inside `lib/db` because it needs the raw handle:
 * it asks whether the database answers at all, which is not a tenant-scoped
 * question and therefore has no `UserId` to take.
 *
 * Returns booleans only. Connection errors are logged here and never travel
 * outwards, so a failing probe cannot leak the host, database name or
 * credentials embedded in the connection string.
 */
export async function checkDatabaseHealth(): Promise<DatabaseHealth> {
  try {
    const rows = await getSql()<{ vector_available: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_available_extensions WHERE name = 'vector'
      ) AS vector_available
    `;
    return { database: true, pgvector: rows[0]?.vector_available ?? false };
  } catch (error) {
    console.error("[health] database probe failed", error);
    return { database: false, pgvector: false };
  }
}
