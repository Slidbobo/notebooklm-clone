import { NextResponse } from "next/server";
import { checkDatabaseHealth } from "@/lib/db/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Liveness probe for the foundation: database reachable, pgvector available. */
export async function GET() {
  const health = await checkDatabaseHealth();
  const ok = health.database && health.pgvector;
  return NextResponse.json(health, { status: ok ? 200 : 503 });
}
