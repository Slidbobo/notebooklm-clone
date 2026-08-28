import { NextResponse } from "next/server";
import { sql } from "@/lib/db/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness probe for the Phase 0 foundation: is the database reachable and is
 * the pgvector extension available on it?
 *
 * The response body carries booleans only. Connection errors are logged server
 * side and never returned to the caller, so a failed probe cannot leak the host,
 * database name, or credentials of the connection string.
 */
export async function GET() {
  try {
    const rows = await sql<{ vector_available: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_available_extensions WHERE name = 'vector'
      ) AS vector_available
    `;

    return NextResponse.json({
      database: true,
      pgvector: rows[0]?.vector_available ?? false,
    });
  } catch (error) {
    console.error("[health] database probe failed", error);
    return NextResponse.json({ database: false, pgvector: false }, { status: 503 });
  }
}
