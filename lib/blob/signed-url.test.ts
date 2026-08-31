import { randomUUID } from "node:crypto";
import { del, put } from "@vercel/blob";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSignedSourceUrl } from "@/lib/blob/signed-url";

/**
 * A signed URL whose expiry is never enforced is just a longer URL.
 *
 * These tests run against the real blob store, because the expiry is enforced by
 * the store and not by this codebase; asserting it locally would only assert
 * that the right number was passed. They are skipped when no store credential is
 * present, which is the case in CI on purpose: the workflow holds no production
 * secrets. The skip is loud rather than silent, so an empty run cannot be
 * mistaken for a passing one.
 */
const hasStore = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

if (!hasStore) {
  console.warn(
    "[signed-url.test] skipped: BLOB_READ_WRITE_TOKEN is not set. " +
      "Run locally with a store credential to exercise signed URL expiry.",
  );
}

describe.skipIf(!hasStore)("signed source URLs", () => {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  const pathname = `fixtures/signed-url/${randomUUID()}.txt`;
  const body = "Vertraulicher Inhalt.";
  let blobUrl: string;

  beforeAll(async () => {
    const blob = await put(pathname, body, {
      access: "private",
      contentType: "text/plain",
      addRandomSuffix: false,
      token,
    });
    blobUrl = blob.url;
  }, 30_000);

  afterAll(async () => {
    if (blobUrl) await del(blobUrl, { token });
  });

  it("refuses the plain blob url without a signature", async () => {
    const response = await fetch(blobUrl, { cache: "no-store" });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });

  it("serves the file through a freshly signed url", async () => {
    const url = await createSignedSourceUrl(pathname, 60);
    const response = await fetch(url, { cache: "no-store" });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(body);
  });

  // The point of the whole mechanism: the grant has to stop working.
  it("refuses a signed url after it has expired", async () => {
    const url = await createSignedSourceUrl(pathname, 2);

    const beforeExpiry = await fetch(url, { cache: "no-store" });
    expect(beforeExpiry.status).toBe(200);

    await new Promise((resolve) => setTimeout(resolve, 4_000));

    const afterExpiry = await fetch(url, { cache: "no-store" });
    expect(afterExpiry.status).toBeGreaterThanOrEqual(400);
  }, 30_000);

  it("signs one pathname only, so a grant cannot be pointed elsewhere", async () => {
    const url = await createSignedSourceUrl(pathname, 60);
    const elsewhere = url.replace(pathname, `fixtures/signed-url/${randomUUID()}.txt`);

    const response = await fetch(elsewhere, { cache: "no-store" });
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});
