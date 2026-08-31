import { config } from "dotenv";

config({ path: ".env.local" });

import { checkCoreEnv, checkDeployEnv, type EnvProblem } from "@/lib/env";
import { probeBlobStore } from "@/lib/blob/health";
import { probeModelProvider } from "@/lib/llm/health";

/**
 * Runs before the build, so a broken configuration stops the deploy instead of
 * producing a green build with a dead application behind it.
 *
 * Two stages. The first checks shape: present, no whitespace, not the
 * "[SENSITIVE]" placeholder that `vercel env pull` writes, and the format each
 * value is supposed to have. The second actually calls the two external
 * providers, because a key can be perfectly well formed and still be revoked.
 * Both probes are metadata calls that cost no tokens and no generation quota.
 *
 * Nothing here prints a value. Failures name the variable and the environment.
 */

/** Vercel builds must be airtight; a local clone should still be buildable. */
const environment = process.env.VERCEL_TARGET_ENV ?? process.env.VERCEL_ENV ?? "local";
const isDeployment = environment !== "local";

function report(problems: EnvProblem[], level: "error" | "warning") {
  for (const { variable, problem } of problems) {
    console.error(`  ${level === "error" ? "✗" : "!"} ${variable}: ${problem}`);
  }
}

/**
 * Probes each credential whose format check passed. They are independent: a
 * missing Blob token locally must not stop the Gemini key from being verified.
 */
async function probeCredentials(malformed: Set<string>): Promise<boolean> {
  const probes = [
    ["GOOGLE_GENERATIVE_AI_API_KEY", probeModelProvider],
    ["BLOB_READ_WRITE_TOKEN", probeBlobStore],
  ] as const;

  const runnable = probes.filter(([name]) => !malformed.has(name));
  const outcomes = await Promise.all(runnable.map(([, probe]) => probe()));
  let fatal = false;

  for (const [index, [name]] of runnable.entries()) {
    const outcome = outcomes[index]!;
    if (outcome.status === "ok") {
      console.log(`  ✓ ${name}: provider accepted the credential`);
      continue;
    }
    // A rejected credential is the operator's problem and must stop the deploy.
    // A network problem during a build is not, and failing on it would make
    // deploys flaky for a reason that has nothing to do with this project.
    if (outcome.reason === "unreachable" || outcome.reason === "rate_limited") {
      console.error(`  ! ${name}: provider ${outcome.reason}, not treated as fatal`);
      continue;
    }
    console.error(`  ✗ ${name}: provider rejected the credential (${outcome.reason})`);
    fatal = true;
  }

  return fatal;
}

async function main() {
  console.log(`Checking environment: ${environment}`);

  const coreProblems = checkCoreEnv();
  const deployProblems = checkDeployEnv();

  report(coreProblems, "error");
  report(deployProblems, isDeployment ? "error" : "warning");

  if (coreProblems.length > 0) {
    console.error(`\nEnvironment check failed for "${environment}". Fix the variables above.`);
    process.exit(1);
  }

  if (deployProblems.length > 0) {
    if (isDeployment) {
      console.error(`\nEnvironment check failed for "${environment}". Fix the variables above.`);
      process.exit(1);
    }
    console.error(
      "\nThese are warnings locally. The parts of the application that need them will not work,\n" +
        "but the build continues so a fresh clone stays buildable.",
    );
  }

  const malformed = new Set(deployProblems.map((problem) => problem.variable));
  const fatal = await probeCredentials(malformed);
  if (fatal) {
    console.error(`\nA provider rejected a credential. Refusing to build "${environment}".`);
    process.exit(1);
  }

  console.log("Environment check passed.");
}

main().catch((error) => {
  console.error("Environment check crashed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
