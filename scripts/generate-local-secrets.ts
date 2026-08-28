import { randomBytes } from "node:crypto";
import { appendFileSync, readFileSync, existsSync } from "node:fs";

/**
 * Fills the local-only secrets in .env.local.
 *
 * Values are written straight to the file and never printed, so they cannot end
 * up in a terminal transcript. Existing entries are left untouched.
 */
const ENV_FILE = ".env.local";

const GENERATED = {
  AUTH_SECRET: () => randomBytes(32).toString("base64"),
  DEMO_A_PASSWORD: () => randomBytes(12).toString("base64url"),
  DEMO_B_PASSWORD: () => randomBytes(12).toString("base64url"),
};

function main() {
  const existing = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";
  const added: string[] = [];

  for (const [name, generate] of Object.entries(GENERATED)) {
    const alreadySet = new RegExp(`^${name}=.+$`, "m").test(existing);
    if (alreadySet) continue;
    appendFileSync(ENV_FILE, `${name}=${generate()}\n`);
    added.push(name);
  }

  if (added.length === 0) {
    console.log(`${ENV_FILE}: all secrets already present, nothing changed`);
    return;
  }
  console.log(`${ENV_FILE}: generated ${added.join(", ")}`);
}

main();
