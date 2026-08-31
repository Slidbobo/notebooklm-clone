import { NextResponse } from "next/server";
import { currentUserId } from "@/lib/auth/session";
import { probeBlobStore } from "@/lib/blob/health";
import { checkDatabaseHealth } from "@/lib/db/health";
import { probeModelProvider, type ProbeOutcome } from "@/lib/llm/health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Health endpoint with two depths.
 *
 * Shallow, the default, touches only the database. It is cheap enough for an
 * uptime monitor to call every minute and makes no external requests.
 *
 * Deep, via `?deep=1`, additionally asks the model provider and the blob store
 * whether they still accept our credentials. It requires a signed-in session:
 * which of our dependencies is currently failing is reconnaissance we do not
 * need to hand out, and gating it on the session we already have avoids
 * introducing another environment variable, which would be one more thing that
 * can be missing. Deriving a token from AUTH_SECRET was the alternative and was
 * dropped because CI cannot hold the production AUTH_SECRET either, so it would
 * not have bought any automation.
 *
 * Responses carry a status and a coarse reason from a fixed vocabulary. Provider
 * messages, status codes and stack traces stay in the server log.
 */

/** Deep probes hit two external services; repeat calls reuse a recent result. */
const DEEP_CACHE_MS = 60_000;

type Check = { status: "ok" } | { status: "failed"; reason: string };

let deepCache: { at: number; checks: Record<string, Check> } | null = null;

async function deepChecks(): Promise<Record<string, Check>> {
  const now = Date.now();
  if (deepCache && now - deepCache.at < DEEP_CACHE_MS) return deepCache.checks;

  const [model, blob] = await Promise.all([probeModelProvider(), probeBlobStore()]);
  const checks: Record<string, Check> = {
    gemini: toCheck(model),
    blob: toCheck(blob),
  };

  deepCache = { at: now, checks };
  return checks;
}

function toCheck(outcome: ProbeOutcome): Check {
  return outcome.status === "ok" ? { status: "ok" } : { status: "failed", reason: outcome.reason };
}

export async function GET(request: Request) {
  const wantsDeep = new URL(request.url).searchParams.get("deep") === "1";

  const database = await checkDatabaseHealth();
  const checks: Record<string, Check> = {
    database: database.database ? { status: "ok" } : { status: "failed", reason: "unreachable" },
    pgvector: database.pgvector ? { status: "ok" } : { status: "failed", reason: "missing" },
  };

  if (wantsDeep) {
    if (!(await currentUserId())) {
      return NextResponse.json(
        { error: "Deep health checks require an authenticated session." },
        { status: 401 },
      );
    }
    Object.assign(checks, await deepChecks());
  }

  const healthy = Object.values(checks).every((check) => check.status === "ok");

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      // Lets a post-deploy check tell the new build apart from a stale instance.
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local",
      depth: wantsDeep ? "deep" : "shallow",
      checks,
    },
    { status: healthy ? 200 : 503 },
  );
}
