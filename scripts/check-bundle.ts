import { config } from "dotenv";

config({ path: ".env.local" });

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Fails the build if a server-side secret reached the browser bundle.
 *
 * Security requirement six says inference happens server side and no key is
 * shipped to the client. That is currently true by construction, because every
 * provider call lives in lib/llm and lib/blob and nothing imports them from a
 * client component. "Currently true by construction" is exactly the kind of
 * property that stops being true during a refactor without anybody noticing, so
 * it is checked rather than asserted in prose.
 *
 * Two passes: the literal values of the secrets this machine knows about, and a
 * shape-based scan for credentials whose value is not available locally.
 */
const SECRET_VARS = [
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "BLOB_READ_WRITE_TOKEN",
  "AUTH_SECRET",
  "AUTH_GITHUB_SECRET",
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "DEMO_A_PASSWORD",
  "DEMO_B_PASSWORD",
];

const SECRET_SHAPES: Array<[string, RegExp]> = [
  ["Google API key", /\b(AIza[A-Za-z0-9_-]{30,}|AQ\.[A-Za-z0-9_-]{30,})\b/],
  ["Vercel Blob token", /\bvercel_blob_rw_[A-Za-z0-9_]{20,}/],
  ["Postgres connection string", /\bpostgres(ql)?:\/\/[^\s"']+:[^\s"']+@/],
];

const BUNDLE_DIR = path.join(process.cwd(), ".next", "static");

async function collectFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await collectFiles(full)));
    else if (/\.(js|css|map)$/.test(entry.name)) files.push(full);
  }

  return files;
}

async function main() {
  const files = await collectFiles(BUNDLE_DIR);
  if (files.length === 0) {
    console.error("No client bundle found. Run this after `next build`.");
    process.exit(1);
  }

  const values: Array<readonly [string, string]> = [];
  for (const name of SECRET_VARS) {
    const value = process.env[name];
    // Short values would produce false positives against minified code.
    if (value && value.length >= 12) values.push([name, value] as const);
  }

  const findings: string[] = [];

  for (const file of files) {
    const content = await readFile(file, "utf8");
    const relative = path.relative(process.cwd(), file);

    for (const [name, value] of values) {
      // The variable name is reported, never the value.
      if (content.includes(value)) findings.push(`${name} appears in ${relative}`);
    }
    for (const [label, pattern] of SECRET_SHAPES) {
      if (pattern.test(content)) findings.push(`a string shaped like a ${label} appears in ${relative}`);
    }
  }

  console.log(
    `Bundle check: ${files.length} client files scanned, ${values.length} known secrets compared.`,
  );

  if (findings.length > 0) {
    console.error("\nSecrets found in the client bundle:");
    for (const finding of findings) console.error(`  ✗ ${finding}`);
    process.exit(1);
  }

  console.log("Bundle check passed: no server-side secret reached the browser.");
}

main().catch((error) => {
  console.error("Bundle check crashed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
