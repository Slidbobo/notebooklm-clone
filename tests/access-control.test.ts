import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb } from "@/lib/db/client";
import { createTenant, removeTenants, type Tenant } from "./helpers/fixtures";

/**
 * The isolation guarantee, asserted against a real pgvector database.
 *
 * These are integration tests on purpose. The claim this project makes is that
 * the tenant filter sits inside the SQL that runs, so a mocked data layer would
 * assert the mock. The same pgvector image runs locally through
 * docker-compose.yml and in CI as a service container.
 */

const account = vi.hoisted(() => ({ current: null as { userId: string; isDemo: boolean } | null }));

vi.mock("@/lib/auth/session", () => ({
  currentAccount: async () =>
    account.current ? { ...account.current, email: "fixture@fixture.test" } : null,
  currentUserId: async () => account.current?.userId ?? null,
}));

let alice: Tenant;
let bob: Tenant;

function signIn(tenant: Tenant | null) {
  account.current = tenant ? { userId: tenant.userId, isDemo: false } : null;
}

beforeAll(async () => {
  alice = await createTenant("alice", 7);
  bob = await createTenant("bob", 11);
});

afterAll(async () => {
  await removeTenants([alice, bob]);
  await closeDb();
});

describe("notebook access", () => {
  it("answers 404, not 403, when B opens A's notebook id", async () => {
    const { getNotebook } = await import("@/lib/db/access");

    expect(await getNotebook(bob.userId, alice.notebookId)).toBeNull();
    // The same call as its owner proves the id is real, so the null above is
    // the filter working rather than a broken query.
    expect(await getNotebook(alice.userId, alice.notebookId)).not.toBeNull();
  });

  it("refuses to rename or delete a foreign notebook", async () => {
    const { deleteNotebook, renameNotebook } = await import("@/lib/db/access");

    expect(await renameNotebook(bob.userId, alice.notebookId, "übernommen")).toBeNull();
    expect(await deleteNotebook(bob.userId, alice.notebookId)).toBe(false);
    expect(await getNotebookTitle(alice)).toBe("alice notebook");
  });

  it("refuses to attach a source to a foreign notebook", async () => {
    const { createSource } = await import("@/lib/db/access");

    const created = await createSource(bob.userId, {
      notebookId: alice.notebookId,
      filename: "untergeschoben.txt",
      mimeType: "text/plain",
      blobPathname: "fixtures/bob/untergeschoben.txt",
    });

    expect(created).toBeNull();
  });
});

describe("vector search", () => {
  // The strongest query an attacker could send: not merely similar to A's
  // content, but the exact vector A's chunk was stored with.
  it("never returns A's chunks to B, even for an exactly matching vector", async () => {
    const { searchChunks } = await import("@/lib/db/access");

    const inOwnNotebook = await searchChunks(bob.userId, bob.notebookId, alice.embedding, 10);
    expect(inOwnNotebook.every((hit) => hit.content.includes("bob"))).toBe(true);
    expect(inOwnNotebook.some((hit) => hit.content.includes("alice"))).toBe(false);
  });

  it("returns nothing when B aims the search at A's notebook id", async () => {
    const { searchChunks } = await import("@/lib/db/access");

    const reachingOver = await searchChunks(bob.userId, alice.notebookId, alice.embedding, 10);
    expect(reachingOver).toHaveLength(0);
  });

  it("finds the chunk for its own owner, so the empty results above mean something", async () => {
    const { searchChunks } = await import("@/lib/db/access");

    const hits = await searchChunks(alice.userId, alice.notebookId, alice.embedding, 10);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.similarity).toBeGreaterThan(0.99);
  });
});

describe("source and file access", () => {
  it("hides a foreign source from the reader", async () => {
    const { getSource } = await import("@/lib/db/access");

    expect(await getSource(bob.userId, alice.sourceId)).toBeNull();
    expect(await getSource(alice.userId, alice.sourceId)).not.toBeNull();
  });

  it("answers 404 when B requests a file link for A's source", async () => {
    const { GET } = await import("@/app/api/sources/[id]/file/route");

    signIn(bob);
    const response = await GET(new Request("http://localhost/api/sources/x/file"), {
      params: Promise.resolve({ id: alice.sourceId }),
    });

    expect(response.status).toBe(404);
  });

  it("answers 401 for an unauthenticated file link request", async () => {
    const { GET } = await import("@/app/api/sources/[id]/file/route");

    signIn(null);
    const response = await GET(new Request("http://localhost/api/sources/x/file"), {
      params: Promise.resolve({ id: alice.sourceId }),
    });

    expect(response.status).toBe(401);
  });
});

describe("unauthenticated requests to protected endpoints", () => {
  it("answers 401 on the chat endpoint", async () => {
    const { POST } = await import("@/app/api/chat/route");

    signIn(null);
    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notebookId: alice.notebookId, question: "Was steht drin?" }),
      }),
    );

    expect(response.status).toBe(401);
  });

  it("answers 401 on the source registration endpoint", async () => {
    const { POST } = await import("@/app/api/sources/route");

    signIn(null);
    const response = await POST(
      new Request("http://localhost/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          notebookId: alice.notebookId,
          filename: "x.txt",
          mimeType: "text/plain",
          blobPathname: "fixtures/x.txt",
        }),
      }),
    );

    expect(response.status).toBe(401);
  });

  it("answers 404 when B asks the chat about A's notebook", async () => {
    const { POST } = await import("@/app/api/chat/route");

    signIn(bob);
    const response = await POST(
      new Request("http://localhost/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notebookId: alice.notebookId, question: "Was steht drin?" }),
      }),
    );

    // 404 rather than 403, and reached before any model call is made.
    expect(response.status).toBe(404);
  });
});

async function getNotebookTitle(tenant: Tenant): Promise<string | undefined> {
  const { getNotebook } = await import("@/lib/db/access");
  return (await getNotebook(tenant.userId, tenant.notebookId))?.title;
}
