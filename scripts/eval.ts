import { config } from "dotenv";

if (process.env.SEED_ENV_FILE) config({ path: process.env.SEED_ENV_FILE });
config({ path: ".env.local" });

import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "@/lib/db/client";
import { notebooks, users } from "@/lib/db/schema";
import { trustedUserIdForSeed, type UserId } from "@/lib/db/user-id";
import { renderAnswer, streamAnswer } from "@/lib/llm/chat";
import { REFUSAL_MARKER } from "@/lib/llm/prompt";
import { retrieveContext } from "@/lib/llm/retrieval";

/**
 * Golden-set runner.
 *
 * Deliberately not part of `npm test` and not part of CI: every case is a real
 * call to the model provider, so a run costs quota and is not deterministic.
 * Putting it in CI would burn the free tier on every push and make a red
 * pipeline mean "the model phrased something differently today".
 *
 * It exercises the same retrieval, the same similarity floor and the same prompt
 * as the chat endpoint, through the shared module rather than a copy.
 */

type Case = {
  id: string;
  account: string;
  question: string;
  expect: "answer" | "refusal";
  expectedSource?: string;
  keywords?: string[];
  forbidden?: string[];
  note?: string;
};

type Outcome = {
  id: string;
  retrieval: "ok" | "miss" | "n/a";
  behaviour: "ok" | "fail";
  detail: string;
  answer: string;
};

async function resolveAccount(email: string): Promise<{ userId: UserId; notebookId: string }> {
  const db = getDb();
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (!user) throw new Error(`Seed account missing: ${email}. Run \`npm run seed\` first.`);

  const [notebook] = await db
    .select({ id: notebooks.id })
    .from(notebooks)
    .where(eq(notebooks.ownerId, user.id));
  if (!notebook) throw new Error(`No notebook for ${email}. Run \`npm run seed\` first.`);

  return { userId: trustedUserIdForSeed(user.id), notebookId: notebook.id };
}

async function runCase(testCase: Case): Promise<Outcome> {
  const { userId, notebookId } = await resolveAccount(testCase.account);
  const { usable } = await retrieveContext(userId, notebookId, testCase.question);

  if (usable.length === 0) {
    // No sources cleared the floor, so the endpoint answers without the model.
    const passed = testCase.expect === "refusal";
    return {
      id: testCase.id,
      retrieval: testCase.expect === "refusal" ? "ok" : "miss",
      behaviour: passed ? "ok" : "fail",
      detail: passed ? "verweigert ohne Modellaufruf" : "keine Quelle über der Schwelle",
      answer: "(Verweigerung)",
    };
  }

  let raw = "";
  try {
    const result = streamAnswer(testCase.question, usable);
    for await (const delta of result.textStream) raw += delta;
  } catch (error) {
    // Surfaced rather than swallowed: an empty answer caused by a provider
    // error looks exactly like an empty answer caused by a bad prompt, and
    // those need different fixes.
    const message = error instanceof Error ? error.message : String(error);
    return {
      id: testCase.id,
      retrieval: "n/a",
      behaviour: "fail",
      detail: `Anbieterfehler: ${message.slice(0, 70)}`,
      answer: "",
    };
  }

  if (raw.trim().length === 0) {
    return {
      id: testCase.id,
      retrieval: "n/a",
      behaviour: "fail",
      detail: "Anbieter lieferte eine leere Antwort",
      answer: "",
    };
  }

  const refused = raw.includes(REFUSAL_MARKER);
  const answer = renderAnswer(raw);
  const retrievedFiles = new Set(usable.map((chunk) => chunk.filename));

  const retrieval: Outcome["retrieval"] = testCase.expectedSource
    ? retrievedFiles.has(testCase.expectedSource)
      ? "ok"
      : "miss"
    : "n/a";

  const problems: string[] = [];

  if (testCase.expect === "refusal" && !refused) {
    problems.push("hat geantwortet statt zu verweigern");
  }
  if (testCase.expect === "answer" && refused) {
    problems.push("hat verweigert statt zu antworten");
  }
  if (!refused) {
    const missing = (testCase.keywords ?? []).filter((word) => !answer.includes(word));
    if (missing.length > 0) problems.push(`Stichwort fehlt: ${missing.join(", ")}`);

    const leaked = (testCase.forbidden ?? []).filter((word) =>
      answer.toUpperCase().includes(word.toUpperCase()),
    );
    if (leaked.length > 0) problems.push(`verbotener Text: ${leaked.join(", ")}`);

    // An answer without a citation is not source-bound, whatever it says.
    if (testCase.expect === "answer" && !/\[\d{1,2}\]/.test(answer)) {
      problems.push("keine Quellennummer in der Antwort");
    }
  }
  if (retrieval === "miss") problems.push(`erwartete Datei nicht abgerufen`);

  return {
    id: testCase.id,
    retrieval,
    behaviour: problems.length === 0 ? "ok" : "fail",
    detail: problems.join("; ") || "erfüllt",
    answer: answer.replace(/\s+/g, " ").slice(0, 90),
  };
}

function renderTable(outcomes: Outcome[]) {
  const width = {
    id: Math.max(4, ...outcomes.map((o) => o.id.length)),
    detail: Math.max(7, ...outcomes.map((o) => o.detail.length)),
  };

  const line = (a: string, b: string, c: string, d: string) =>
    `| ${a.padEnd(width.id)} | ${b.padEnd(9)} | ${c.padEnd(9)} | ${d.padEnd(width.detail)} |`;

  console.log(line("Fall", "Retrieval", "Verhalten", "Anmerkung"));
  console.log(
    `|${"-".repeat(width.id + 2)}|${"-".repeat(11)}|${"-".repeat(11)}|${"-".repeat(width.detail + 2)}|`,
  );
  for (const outcome of outcomes) {
    console.log(line(outcome.id, outcome.retrieval, outcome.behaviour, outcome.detail));
  }
}

async function main() {
  const raw = await readFile(path.join(process.cwd(), "evals", "golden-set.json"), "utf8");
  const { cases } = JSON.parse(raw) as { cases: Case[] };

  const outcomes: Outcome[] = [];
  for (const testCase of cases) {
    // Sequential on purpose: the free tier limits requests per minute, and a
    // parallel run would measure the rate limiter instead of the system.
    process.stderr.write(`… ${testCase.id}\n`);
    outcomes.push(await runCase(testCase));
    // Free-tier requests per minute are the binding constraint on a run this
    // size. Pacing keeps the eval measuring the system rather than the quota.
    await new Promise((resolve) => setTimeout(resolve, 4_000));
  }

  console.log();
  renderTable(outcomes);

  const failed = outcomes.filter((outcome) => outcome.behaviour === "fail");
  console.log(`\n${outcomes.length - failed.length} von ${outcomes.length} Fällen erfüllt.`);

  if (failed.length > 0) {
    console.log("\nFehlgeschlagen:");
    for (const outcome of failed) console.log(`  ${outcome.id}: ${outcome.detail}\n    ${outcome.answer}`);
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error("Eval failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeDb);
