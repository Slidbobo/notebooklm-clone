import { consumeRateLimit, type RateLimitVerdict } from "@/lib/db/access";
import type { UserId } from "@/lib/db/user-id";

/**
 * Request budgets for the endpoints that cost money or quota.
 *
 * The demo accounts get a tighter budget than a real account, because their
 * credentials are published in the README on purpose: anybody who reads the
 * submission can sign in, and a shared account with a normal budget is a shared
 * account with a normal way to exhaust the free tier for everyone else.
 */
const WINDOW_SECONDS = 60 * 60;

const BUDGETS = {
  chat: { demo: 20, standard: 60 },
  ingestion: { demo: 10, standard: 30 },
} as const;

export type Bucket = keyof typeof BUDGETS;

export async function checkRateLimit(
  userId: UserId,
  bucket: Bucket,
  isDemoAccount: boolean,
): Promise<RateLimitVerdict> {
  const budget = BUDGETS[bucket];
  const limit = isDemoAccount ? budget.demo : budget.standard;
  return consumeRateLimit(userId, bucket, limit, WINDOW_SECONDS);
}

/** Standard headers so a client can back off instead of retrying blindly. */
export function rateLimitHeaders(verdict: RateLimitVerdict): Record<string, string> {
  return {
    "retry-after": String(verdict.resetSeconds),
    "x-ratelimit-remaining": String(verdict.remaining),
  };
}
