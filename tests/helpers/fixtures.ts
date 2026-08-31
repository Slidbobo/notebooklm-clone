import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { chunks, notebooks, sources, users } from "@/lib/db/schema";
import { trustedUserIdForSeed, type UserId } from "@/lib/db/user-id";
import { EMBEDDING_DIMENSIONS } from "@/lib/llm/config";

export type Tenant = {
  userId: UserId;
  email: string;
  notebookId: string;
  sourceId: string;
  chunkId: string;
  embedding: number[];
};

/**
 * A deterministic unit vector.
 *
 * Real embeddings are deliberately avoided here. They would make the suite
 * depend on an API key in CI, and they would make the central assertion weaker
 * rather than stronger: what the tenant filter has to survive is not a
 * semantically close query but an exactly matching one. A fixed vector lets the
 * test hand account B the identical vector that account A's chunk was stored
 * with, which is the strongest query an attacker could construct.
 */
export function fixedVector(seed: number): number[] {
  const raw = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) =>
    Math.sin((i + 1) * seed * 0.001),
  );
  const magnitude = Math.hypot(...raw);
  return raw.map((value) => value / magnitude);
}

export async function createTenant(label: string, seed: number): Promise<Tenant> {
  const db = getDb();
  const email = `${label}-${randomUUID()}@fixture.test`;

  const [user] = await db.insert(users).values({ email, name: label }).returning({ id: users.id });
  const userId = trustedUserIdForSeed(user!.id);

  const [notebook] = await db
    .insert(notebooks)
    .values({ ownerId: userId, title: `${label} notebook` })
    .returning({ id: notebooks.id });

  const [source] = await db
    .insert(sources)
    .values({
      notebookId: notebook!.id,
      ownerId: userId,
      filename: `${label}.txt`,
      mimeType: "text/plain",
      blobPathname: `fixtures/${label}/${randomUUID()}.txt`,
      status: "ready",
      extractedText: `Vertraulicher Inhalt von ${label}.`,
    })
    .returning({ id: sources.id });

  const embedding = fixedVector(seed);
  const [chunk] = await db
    .insert(chunks)
    .values({
      sourceId: source!.id,
      notebookId: notebook!.id,
      ownerId: userId,
      content: `Vertraulicher Inhalt von ${label}.`,
      charStart: 0,
      charEnd: 33,
      embedding,
    })
    .returning({ id: chunks.id });

  return {
    userId,
    email,
    notebookId: notebook!.id,
    sourceId: source!.id,
    chunkId: chunk!.id,
    embedding,
  };
}

/** Removes the fixture accounts; foreign keys take the rest with them. */
export async function removeTenants(tenants: Tenant[]) {
  if (tenants.length === 0) return;
  await getDb()
    .delete(users)
    .where(inArray(users.id, tenants.map((tenant) => tenant.userId as string)));
}

export async function countChunksOf(tenant: Tenant): Promise<number> {
  const rows = await getDb().select().from(chunks).where(eq(chunks.ownerId, tenant.userId));
  return rows.length;
}
