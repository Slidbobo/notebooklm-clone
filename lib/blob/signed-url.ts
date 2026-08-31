import { issueSignedToken, presignUrl } from "@vercel/blob";

/**
 * Short-lived, read-only URL for one stored file.
 *
 * The blob store is private, so a stored file has no address anybody can fetch.
 * Access is granted per request, after the caller's ownership of the source has
 * been established, and the grant is scoped three ways: to a single pathname, to
 * the `get` operation, and to a deadline measured in seconds.
 *
 * The deadline is the part worth testing. A signed URL whose expiry is never
 * enforced is just a longer URL, so `signed-url.test.ts` issues one with a
 * two-second life, waits it out, and asserts the store refuses it.
 */
const DEFAULT_TTL_SECONDS = 60;

export async function createSignedSourceUrl(
  pathname: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<string> {
  const validUntil = Date.now() + ttlSeconds * 1_000;
  const token = process.env.BLOB_READ_WRITE_TOKEN;

  const delegation = await issueSignedToken({
    pathname,
    operations: ["get"],
    validUntil,
    token,
  });

  const { presignedUrl } = await presignUrl(delegation, {
    operation: "get",
    access: "private",
    pathname,
    validUntil,
  });

  return presignedUrl;
}
