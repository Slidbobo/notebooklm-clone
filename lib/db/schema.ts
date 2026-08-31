import {
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";
import { EMBEDDING_DIMENSIONS } from "@/lib/llm/config";

/* -------------------------------------------------------------------------- */
/* Auth.js tables                                                             */
/* -------------------------------------------------------------------------- */

export const users = pgTable("users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("email_verified", { withTimezone: true, mode: "date" }),
  image: text("image"),
  /**
   * Only ever set for the two seeded demo accounts. GitHub users authenticate
   * through OAuth and keep this null, which is also what makes it impossible to
   * sign in as an OAuth user through the credentials provider.
   */
  passwordHash: text("password_hash"),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerAccountId] }),
    index("accounts_user_id_idx").on(table.userId),
  ],
);

/**
 * Required by the Drizzle adapter's type, but unused at runtime: mixing a
 * credentials provider with OAuth forces the JWT session strategy for both, so
 * Auth.js never writes a row here. The consequence, that a logout cannot be
 * invalidated server side, is spelled out in the README.
 */
export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true, mode: "date" }).notNull(),
});

/* -------------------------------------------------------------------------- */
/* Application tables                                                         */
/* -------------------------------------------------------------------------- */

export const sourceStatus = pgEnum("source_status", [
  "pending",
  "extracting",
  "embedding",
  "ready",
  "failed",
]);

export const messageRole = pgEnum("message_role", ["user", "assistant"]);

/**
 * `ownerId` is repeated on every table below instead of being reached through a
 * join to `notebooks`. It is denormalised on purpose: the tenant filter then
 * sits in the same WHERE clause as the query it protects, most importantly the
 * vector search, rather than in a separate check that a future caller could
 * forget to perform. Every foreign key is still in place, so the duplication
 * cannot drift as long as writes go through the access layer, which is the only
 * thing allowed to touch these tables.
 */
export const notebooks = pgTable(
  "notebooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("notebooks_owner_idx").on(table.ownerId, table.createdAt)],
);

export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    notebookId: uuid("notebook_id")
      .notNull()
      .references(() => notebooks.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    blobPathname: text("blob_pathname").notNull(),
    status: sourceStatus("status").notNull().default("pending"),
    statusMessage: text("status_message"),
    extractedText: text("extracted_text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("sources_owner_notebook_idx").on(table.ownerId, table.notebookId),
    uniqueIndex("sources_blob_pathname_idx").on(table.blobPathname),
  ],
);

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    notebookId: uuid("notebook_id")
      .notNull()
      .references(() => notebooks.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    /** Character offsets into `sources.extractedText`, used by the citation jump. */
    charStart: integer("char_start").notNull(),
    charEnd: integer("char_end").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
  },
  (table) => [
    // Serves the tenant filter of the vector search. Postgres applies it
    // alongside the HNSW scan; the filter is part of the query either way, so
    // the guarantee does not depend on which plan the planner picks.
    index("chunks_owner_notebook_idx").on(table.ownerId, table.notebookId),
    index("chunks_source_idx").on(table.sourceId),
    index("chunks_embedding_idx")
      .using("hnsw", table.embedding.op("vector_cosine_ops")),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    notebookId: uuid("notebook_id")
      .notNull()
      .references(() => notebooks.id, { onDelete: "cascade" }),
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: messageRole("role").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("messages_owner_notebook_idx").on(table.ownerId, table.notebookId, table.createdAt),
  ],
);

export const citations = pgTable(
  "citations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    chunkId: uuid("chunk_id")
      .notNull()
      .references(() => chunks.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("citations_message_chunk_idx").on(table.messageId, table.chunkId),
  ],
);

/**
 * Fixed-window request counter.
 *
 * One row per account and bucket, updated in a single statement so two
 * concurrent requests cannot both read the old count and both be allowed. A
 * counter in Postgres rather than a dedicated rate-limiting service: the
 * database is already a dependency, and adding infrastructure for a demo would
 * be a larger operational surface than the problem warrants.
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    ownerId: text("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bucket: text("bucket").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
    count: integer("count").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.ownerId, table.bucket] })],
);
