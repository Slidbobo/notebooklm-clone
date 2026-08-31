import {
  BlobAccessError,
  BlobServiceNotAvailable,
  BlobStoreNotFoundError,
  BlobStoreSuspendedError,
  list,
} from "@vercel/blob";
import type { ProbeOutcome } from "@/lib/llm/health";

/**
 * Credential probe for Blob storage.
 *
 * Lists a single entry. That is a metadata call, it transfers no object data,
 * but it fails when the token is missing, malformed, revoked, or points at a
 * store that no longer exists.
 *
 * The SDK throws typed errors, so the outcome is derived from the error class
 * rather than from its message. An earlier version matched on message text and
 * silently classified a forged token as a network problem, which would have let
 * a dead token through the build check.
 */
const TIMEOUT_MS = 5_000;

export async function probeBlobStore(): Promise<ProbeOutcome> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return { status: "failed", reason: "misconfigured" };

  try {
    await list({ limit: 1, token, abortSignal: AbortSignal.timeout(TIMEOUT_MS) });
    return { status: "ok" };
  } catch (error) {
    const label = error instanceof Error ? error.constructor.name : "unknown";
    console.error(`[health] blob probe failed: ${label}`);

    if (error instanceof BlobAccessError) {
      return { status: "failed", reason: "unauthorized" };
    }
    if (error instanceof BlobStoreNotFoundError || error instanceof BlobStoreSuspendedError) {
      // A forged or stale token lands here: the store it names does not exist.
      return { status: "failed", reason: "misconfigured" };
    }
    if (error instanceof BlobServiceNotAvailable) {
      return { status: "failed", reason: "unreachable" };
    }
    if (error instanceof Error && error.name === "TimeoutError") {
      return { status: "failed", reason: "unreachable" };
    }
    return { status: "failed", reason: "unexpected" };
  }
}
