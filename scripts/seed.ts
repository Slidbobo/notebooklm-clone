import { config } from "dotenv";

config({ path: ".env.local" });

import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { hashPassword } from "@/lib/auth/password";
import { createNotebook, createSource, saveExtractedText } from "@/lib/db/access";
import { closeDb, getDb } from "@/lib/db/client";
import { notebooks, users } from "@/lib/db/schema";
import { trustedUserIdForSeed, type UserId } from "@/lib/db/user-id";

/**
 * Demo data for the two credential accounts.
 *
 * The two notebooks are deliberately far apart in subject matter. A question
 * about container handling has no plausible neighbour in a notebook about heat
 * pumps, so when account B asks it and gets nothing back, that is the tenant
 * filter working and not the embeddings being vague.
 */
const SEED = [
  {
    email: "demo-a@example.com",
    name: "Demo A",
    passwordEnv: "DEMO_A_PASSWORD",
    notebook: "Wärmeversorgung im Bestand",
    documents: [
      "waermepumpen-grundlagen.txt",
      "photovoltaik-eigenverbrauch.txt",
      // Carries an embedded instruction block for the live injection demo.
      "foerderrichtlinie-2026.txt",
    ],
  },
  {
    email: "demo-b@example.com",
    name: "Demo B",
    passwordEnv: "DEMO_B_PASSWORD",
    notebook: "Hafenlogistik",
    documents: ["containerumschlag.txt", "zollabwicklung.txt"],
  },
] as const;

const DOCUMENT_DIR = path.join(process.cwd(), "seed", "documents");

function requirePassword(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing environment variable: ${name}. Run \`npm run secrets:local\` to generate the demo passwords.`,
    );
  }
  return value;
}

/** Creates the account or updates its password, so the seed can be re-run. */
async function upsertUser(email: string, name: string, password: string): Promise<UserId> {
  const passwordHash = await hashPassword(password);
  const db = getDb();

  const [updated] = await db
    .update(users)
    .set({ passwordHash, name })
    .where(eq(users.email, email))
    .returning({ id: users.id });

  if (updated) return trustedUserIdForSeed(updated.id);

  const [created] = await db.insert(users).values({ email, name, passwordHash }).returning({
    id: users.id,
  });
  if (!created) throw new Error(`Failed to create demo account ${email}`);
  return trustedUserIdForSeed(created.id);
}

/**
 * Removes the account's notebooks before rebuilding them. Sources, chunks,
 * messages and citations disappear with them through the foreign keys, so a
 * re-run cannot leave a half-updated notebook behind.
 */
async function resetNotebooks(userId: UserId) {
  await getDb().delete(notebooks).where(eq(notebooks.ownerId, userId));
}

async function seedAccount(entry: (typeof SEED)[number]) {
  const password = requirePassword(entry.passwordEnv);
  const userId = await upsertUser(entry.email, entry.name, password);
  await resetNotebooks(userId);

  const notebook = await createNotebook(userId, entry.notebook);
  if (!notebook) throw new Error(`Failed to create notebook for ${entry.email}`);

  for (const filename of entry.documents) {
    const text = await readFile(path.join(DOCUMENT_DIR, filename), "utf8");
    const source = await createSource(userId, {
      notebookId: notebook.id,
      filename,
      mimeType: "text/plain",
      // Seeded documents live in the repository, not in Blob storage. Phase 2
      // uploads them and replaces this placeholder with the real object path.
      blobPathname: `seed/${entry.email}/${filename}`,
    });
    if (!source) throw new Error(`Failed to create source ${filename}`);
    await saveExtractedText(userId, source.id, text);
  }

  console.log(
    `${entry.email}: notebook "${entry.notebook}" with ${entry.documents.length} sources`,
  );
}

async function main() {
  for (const entry of SEED) {
    await seedAccount(entry);
  }
  console.log(
    "Seed complete. Sources carry extracted text and status 'pending'; chunking and embeddings follow in Phase 2.",
  );
}

main()
  .catch((error) => {
    console.error("Seed failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(closeDb);
