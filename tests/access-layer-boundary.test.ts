import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

/**
 * The lint rule is the half of the isolation guarantee that TypeScript cannot
 * carry: branded ids force every access-layer function to be called with a real
 * session subject, but nothing in the type system stops a route handler from
 * importing the database handle and writing a query with no owner filter.
 *
 * A rule that has silently stopped matching looks exactly like a codebase with
 * no violations. These tests lint a deliberate violation to tell the two apart.
 */
const VIOLATION = `import { getSql } from "@/lib/db/client";\nexport const handle = () => getSql();\n`;

async function lint(source: string, filePath: string) {
  const eslint = new ESLint();
  const [result] = await eslint.lintText(source, { filePath });
  return result?.messages ?? [];
}

describe("database access boundary", () => {
  it("rejects importing the database handle from a route handler", async () => {
    const messages = await lint(VIOLATION, "app/api/probe/route.ts");
    const restricted = messages.filter((m) => m.ruleId === "no-restricted-imports");

    expect(restricted).toHaveLength(1);
    expect(restricted[0]?.message).toContain("lib/db/access.ts");
  });

  it("rejects opening a raw driver connection outside lib/db", async () => {
    const messages = await lint(
      `import postgres from "postgres";\nexport const sql = postgres("");\n`,
      "app/api/probe/route.ts",
    );

    expect(messages.some((m) => m.ruleId === "no-restricted-imports")).toBe(true);
  });

  it("allows the same import from inside lib/db", async () => {
    const messages = await lint(VIOLATION, "lib/db/somewhere.ts");
    expect(messages.filter((m) => m.ruleId === "no-restricted-imports")).toHaveLength(0);
  });
});
