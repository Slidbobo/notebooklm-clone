/**
 * Credential probe for the model provider.
 *
 * Lists the models the key may see. That call costs no tokens and no generation
 * quota, but it fails exactly the way a real request would when the key is
 * invalid, revoked, restricted to other APIs, or blocked for the region, which
 * is the failure this probe exists to catch.
 *
 * It lives here rather than in the health route because every call to the
 * provider goes through `lib/llm/`, including the ones that only ask whether the
 * provider is reachable at all.
 */
import { google } from "@ai-sdk/google";
import { generateText } from "ai";
import { CHAT_MODEL, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "@/lib/llm/config";
import { embed } from "ai";

const MODELS_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
const TIMEOUT_MS = 5_000;

/**
 * A deliberately small vocabulary. Provider error bodies can echo back request
 * details and are never forwarded to a caller; the reason is mapped to one of
 * these instead.
 */
export type ProbeOutcome =
  | { status: "ok" }
  | { status: "failed"; reason: "unauthorized" | "rate_limited" | "unreachable" | "misconfigured" | "unexpected" };

export async function probeModelProvider(): Promise<ProbeOutcome> {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  if (!apiKey) return { status: "failed", reason: "misconfigured" };

  try {
    const response = await fetch(`${MODELS_ENDPOINT}?pageSize=1`, {
      headers: { "x-goog-api-key": apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });

    if (response.ok) return { status: "ok" };

    if (response.status === 401 || response.status === 403) {
      return { status: "failed", reason: "unauthorized" };
    }
    if (response.status === 429) {
      return { status: "failed", reason: "rate_limited" };
    }
    // Log the status code server side; the caller only learns that it failed.
    console.error("[health] model provider probe returned", response.status);
    return { status: "failed", reason: "unexpected" };
  } catch (error) {
    const label = error instanceof Error ? error.name : "unknown";
    console.error(`[health] model provider probe failed: ${label}`);
    return { status: "failed", reason: "unreachable" };
  }
}

/**
 * Verifies that the configured models can actually be called.
 *
 * Listing is not enough, and this is not hypothetical: gemini-2.5-flash-lite is
 * still returned by the models endpoint but the API refuses it for new keys with
 * "no longer available to new users". That failure surfaced during Phase 3 as an
 * empty answer stream in production-shaped code, which is exactly the silent
 * breakage the build check exists to prevent.
 *
 * Both calls are the smallest the API allows: a handful of tokens on each
 * deploy, against a free-tier quota measured in thousands.
 */
export async function probeConfiguredModels(): Promise<ProbeOutcome> {
  if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return { status: "failed", reason: "misconfigured" };
  }

  try {
    const [chat, embedding] = await Promise.all([
      generateText({
        model: google(CHAT_MODEL),
        prompt: "ok",
        maxOutputTokens: 1,
        abortSignal: AbortSignal.timeout(TIMEOUT_MS * 2),
      }),
      embed({
        model: google.embedding(EMBEDDING_MODEL),
        value: "ok",
        providerOptions: { google: { outputDimensionality: EMBEDDING_DIMENSIONS } },
        abortSignal: AbortSignal.timeout(TIMEOUT_MS * 2),
      }),
    ]);

    if (embedding.embedding.length !== EMBEDDING_DIMENSIONS) {
      console.error("[health] embedding model returned", embedding.embedding.length, "dimensions");
      return { status: "failed", reason: "misconfigured" };
    }
    void chat;
    return { status: "ok" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    console.error("[health] model probe failed:", message.slice(0, 200));

    if (/no longer available|not found|not supported/i.test(message)) {
      return { status: "failed", reason: "misconfigured" };
    }
    if (/quota|rate/i.test(message)) return { status: "failed", reason: "rate_limited" };
    if (/api key|permission|unauthor/i.test(message)) {
      return { status: "failed", reason: "unauthorized" };
    }
    return { status: "failed", reason: "unreachable" };
  }
}
