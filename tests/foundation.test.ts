import { afterAll, describe, expect, it } from "vitest";
import { sql } from "@/lib/db/client";

/**
 * Phase 0 foundation test.
 *
 * The access-control tests of Phase 4 are integration tests against a real
 * pgvector database. This test proves that the connection path used by those
 * tests works, in CI as well as locally, before anything is built on top of it.
 */
describe("database foundation", () => {
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it("reaches the database", async () => {
    const rows = await sql<{ one: number }[]>`SELECT 1 AS one`;
    expect(rows[0]?.one).toBe(1);
  });

  it("offers the pgvector extension", async () => {
    const rows = await sql<{ available: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_available_extensions WHERE name = 'vector'
      ) AS available
    `;
    expect(rows[0]?.available).toBe(true);
  });

  it("can create a vector column and query it", async () => {
    await sql`CREATE EXTENSION IF NOT EXISTS vector`;
    await sql`CREATE TEMP TABLE foundation_probe (id int, embedding vector(3))`;
    await sql`INSERT INTO foundation_probe VALUES (1, '[1,0,0]'), (2, '[0,1,0]')`;

    const rows = await sql<{ id: number }[]>`
      SELECT id FROM foundation_probe
      ORDER BY embedding <=> '[1,0,0]'::vector
      LIMIT 1
    `;

    expect(rows[0]?.id).toBe(1);
  });
});
