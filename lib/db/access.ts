import { and, asc, count, cosineDistance, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { chunks, citations, messages, notebooks, rateLimits, sources } from "@/lib/db/schema";
import type { UserId } from "@/lib/db/user-id";

/**
 * The tenant-scoped access layer.
 *
 * This module is the only place in the application that reads or writes
 * application data. Three rules hold for every function below, and together they
 * are the whole of the isolation guarantee:
 *
 * 1. The first parameter is a `UserId`, a branded string that cannot be
 *    fabricated from request input. A route handler that has not resolved a
 *    session has nothing to pass here and will not compile.
 *
 * 2. Every statement carries `eq(table.ownerId, userId)` in its WHERE clause.
 *    That is why `ownerId` is denormalised onto every table rather than reached
 *    through a join to `notebooks`: the tenant filter then lives in the same
 *    clause as the query it protects, including the vector search, instead of
 *    in a separate check further up the call stack that a later caller could
 *    forget. A missing filter is visible in the query itself, not in its
 *    absence somewhere else.
 *
 * 3. A row that exists but belongs to somebody else is indistinguishable from a
 *    row that does not exist: these functions return `null` or `false` either
 *    way, so callers answer 404 and never confirm that an id is real.
 *
 * What the type system cannot do is stop somebody from bypassing this module
 * entirely and importing the database handle directly. TypeScript has no notion
 * of "this import is only legal from that directory". That gap is closed by the
 * `no-restricted-imports` rule in eslint.config.mjs, which forbids importing
 * `lib/db/client` or a raw driver anywhere outside `lib/db/`, and by a test that
 * lints a synthetic violation to prove the rule is actually armed rather than
 * silently misconfigured.
 */

/** Upper bound on any result set, so no caller can ask for an unbounded read. */
const MAX_ROWS = 100;

function clampLimit(limit: number): number {
  return Math.max(1, Math.min(Math.trunc(limit), MAX_ROWS));
}

/* -------------------------------------------------------------------------- */
/* Notebooks                                                                  */
/* -------------------------------------------------------------------------- */

export async function listNotebooks(userId: UserId) {
  return getDb()
    .select()
    .from(notebooks)
    .where(eq(notebooks.ownerId, userId))
    .orderBy(desc(notebooks.createdAt))
    .limit(MAX_ROWS);
}

export async function createNotebook(userId: UserId, title: string) {
  const [created] = await getDb()
    .insert(notebooks)
    .values({ ownerId: userId, title })
    .returning();
  return created ?? null;
}

export async function getNotebook(userId: UserId, notebookId: string) {
  const [found] = await getDb()
    .select()
    .from(notebooks)
    .where(and(eq(notebooks.id, notebookId), eq(notebooks.ownerId, userId)))
    .limit(1);
  return found ?? null;
}

export async function renameNotebook(userId: UserId, notebookId: string, title: string) {
  const [updated] = await getDb()
    .update(notebooks)
    .set({ title })
    .where(and(eq(notebooks.id, notebookId), eq(notebooks.ownerId, userId)))
    .returning();
  return updated ?? null;
}

export async function deleteNotebook(userId: UserId, notebookId: string) {
  const deleted = await getDb()
    .delete(notebooks)
    .where(and(eq(notebooks.id, notebookId), eq(notebooks.ownerId, userId)))
    .returning({ id: notebooks.id });
  return deleted.length > 0;
}

/* -------------------------------------------------------------------------- */
/* Sources                                                                    */
/* -------------------------------------------------------------------------- */

type NewSource = {
  notebookId: string;
  filename: string;
  mimeType: string;
  blobPathname: string;
};

export async function createSource(userId: UserId, source: NewSource) {
  // The notebook is fetched through the tenant-scoped reader, so a source can
  // never be attached to a notebook the caller does not own.
  const notebook = await getNotebook(userId, source.notebookId);
  if (!notebook) return null;

  const [created] = await getDb()
    .insert(sources)
    .values({ ...source, ownerId: userId })
    .returning();
  return created ?? null;
}

export async function listSources(userId: UserId, notebookId: string) {
  return getDb()
    .select()
    .from(sources)
    .where(and(eq(sources.ownerId, userId), eq(sources.notebookId, notebookId)))
    .orderBy(desc(sources.createdAt))
    .limit(MAX_ROWS);
}

/** Enforces the per-notebook upload quota. Scoped like every other read. */
export async function countSources(userId: UserId, notebookId: string): Promise<number> {
  const [row] = await getDb()
    .select({ total: count() })
    .from(sources)
    .where(and(eq(sources.ownerId, userId), eq(sources.notebookId, notebookId)));
  return row?.total ?? 0;
}

export async function getSource(userId: UserId, sourceId: string) {
  const [found] = await getDb()
    .select()
    .from(sources)
    .where(and(eq(sources.id, sourceId), eq(sources.ownerId, userId)))
    .limit(1);
  return found ?? null;
}

type SourceStatus = (typeof sources.status.enumValues)[number];

export async function updateSourceStatus(
  userId: UserId,
  sourceId: string,
  status: SourceStatus,
  statusMessage: string | null = null,
) {
  const [updated] = await getDb()
    .update(sources)
    .set({ status, statusMessage })
    .where(and(eq(sources.id, sourceId), eq(sources.ownerId, userId)))
    .returning({ id: sources.id });
  return updated !== undefined;
}

export async function saveExtractedText(userId: UserId, sourceId: string, text: string) {
  const [updated] = await getDb()
    .update(sources)
    .set({ extractedText: text })
    .where(and(eq(sources.id, sourceId), eq(sources.ownerId, userId)))
    .returning({ id: sources.id });
  return updated !== undefined;
}

/* -------------------------------------------------------------------------- */
/* Chunks                                                                     */
/* -------------------------------------------------------------------------- */

type NewChunk = {
  sourceId: string;
  notebookId: string;
  content: string;
  charStart: number;
  charEnd: number;
  embedding: number[];
};

/** Removes a source and, through the foreign keys, everything derived from it. */
export async function deleteSource(userId: UserId, sourceId: string) {
  const deleted = await getDb()
    .delete(sources)
    .where(and(eq(sources.id, sourceId), eq(sources.ownerId, userId)))
    .returning({ id: sources.id, blobPathname: sources.blobPathname });
  return deleted[0] ?? null;
}

/** Discards a source's chunks before re-ingesting it, so a retry cannot duplicate. */
export async function deleteChunksForSource(userId: UserId, sourceId: string) {
  await getDb()
    .delete(chunks)
    .where(and(eq(chunks.ownerId, userId), eq(chunks.sourceId, sourceId)));
}

export async function insertChunks(userId: UserId, rows: NewChunk[]) {
  if (rows.length === 0) return 0;
  const inserted = await getDb()
    .insert(chunks)
    .values(rows.map((row) => ({ ...row, ownerId: userId })))
    .returning({ id: chunks.id });
  return inserted.length;
}

/**
 * Nearest-neighbour search inside one notebook.
 *
 * The tenant filter and the notebook filter sit in the same WHERE clause as the
 * distance ordering. There is no variant of this function without them, and no
 * caller can pass a user id it did not get from a session, which is what makes
 * "user B never retrieves user A's chunks" a property of the query rather than
 * of the discipline of whoever calls it.
 */
export async function searchChunks(
  userId: UserId,
  notebookId: string,
  queryEmbedding: number[],
  limit = 8,
) {
  const distance = cosineDistance(chunks.embedding, queryEmbedding);

  return getDb()
    .select({
      id: chunks.id,
      sourceId: chunks.sourceId,
      filename: sources.filename,
      content: chunks.content,
      charStart: chunks.charStart,
      charEnd: chunks.charEnd,
      // Parenthesised on purpose: the pgvector operators bind more loosely than
      // arithmetic, so `1 - a <=> b` would parse as `(1 - a) <=> b` and fail.
      similarity: sql<number>`1 - (${distance})`,
    })
    .from(chunks)
    .innerJoin(sources, eq(sources.id, chunks.sourceId))
    .where(and(eq(chunks.ownerId, userId), eq(chunks.notebookId, notebookId)))
    .orderBy(distance)
    .limit(clampLimit(limit));
}

/* -------------------------------------------------------------------------- */
/* Messages and citations                                                     */
/* -------------------------------------------------------------------------- */

type NewMessage = {
  notebookId: string;
  role: "user" | "assistant";
  content: string;
};

export async function appendMessage(userId: UserId, message: NewMessage) {
  const [created] = await getDb()
    .insert(messages)
    .values({ ...message, ownerId: userId })
    .returning();
  return created ?? null;
}

export async function listMessages(userId: UserId, notebookId: string) {
  return getDb()
    .select()
    .from(messages)
    .where(and(eq(messages.ownerId, userId), eq(messages.notebookId, notebookId)))
    .orderBy(asc(messages.createdAt))
    .limit(MAX_ROWS);
}

/**
 * Records which chunks an answer actually cited.
 *
 * Written after the stream finishes, because the citation markers only exist
 * once the model has produced them. Chunk ids are filtered through the caller's
 * retrieval result, so a hallucinated number cannot create a row.
 */
export async function saveCitations(userId: UserId, messageId: string, chunkIds: string[]) {
  if (chunkIds.length === 0) return 0;

  // The message is fetched through the tenant filter first: a foreign message id
  // must not gain citations.
  const [owned] = await getDb()
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.id, messageId), eq(messages.ownerId, userId)))
    .limit(1);
  if (!owned) return 0;

  const inserted = await getDb()
    .insert(citations)
    .values(chunkIds.map((chunkId) => ({ messageId, chunkId })))
    .onConflictDoNothing()
    .returning({ id: citations.id });

  return inserted.length;
}

/** Citations for a set of messages, with the position needed for the jump. */
export async function listCitations(userId: UserId, messageIds: string[]) {
  if (messageIds.length === 0) return [];

  return getDb()
    .select({
      messageId: citations.messageId,
      chunkId: chunks.id,
      sourceId: chunks.sourceId,
      filename: sources.filename,
      charStart: chunks.charStart,
      charEnd: chunks.charEnd,
    })
    .from(citations)
    .innerJoin(chunks, eq(chunks.id, citations.chunkId))
    .innerJoin(sources, eq(sources.id, chunks.sourceId))
    .innerJoin(messages, eq(messages.id, citations.messageId))
    .where(and(eq(messages.ownerId, userId), inArray(citations.messageId, messageIds)));
}

/* -------------------------------------------------------------------------- */
/* Rate limiting                                                              */
/* -------------------------------------------------------------------------- */

export type RateLimitVerdict = { allowed: boolean; remaining: number; resetSeconds: number };

/**
 * Counts one request against a per-account fixed window.
 *
 * The whole decision is one statement. Reading the count and then writing it
 * back would let two concurrent requests both see the old value and both pass,
 * which is precisely the case a rate limit exists for. The window resets inside
 * the same UPDATE rather than in a separate cleanup job.
 */
export async function consumeRateLimit(
  userId: UserId,
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitVerdict> {
  const rows = await getDb()
    .insert(rateLimits)
    .values({ ownerId: userId, bucket, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.ownerId, rateLimits.bucket],
      set: {
        count: sql`CASE WHEN ${rateLimits.windowStart} < now() - make_interval(secs => ${windowSeconds})
                        THEN 1 ELSE ${rateLimits.count} + 1 END`,
        windowStart: sql`CASE WHEN ${rateLimits.windowStart} < now() - make_interval(secs => ${windowSeconds})
                              THEN now() ELSE ${rateLimits.windowStart} END`,
      },
    })
    .returning({
      count: rateLimits.count,
      resetSeconds: sql<number>`GREATEST(0, ${windowSeconds} - EXTRACT(EPOCH FROM (now() - ${rateLimits.windowStart})))::int`,
    });

  const row = rows[0];
  if (!row) return { allowed: false, remaining: 0, resetSeconds: windowSeconds };

  return {
    allowed: row.count <= limit,
    remaining: Math.max(0, limit - row.count),
    resetSeconds: row.resetSeconds,
  };
}
