import { z } from "zod";

/**
 * Environment validation, shared by the build check and the runtime.
 *
 * One schema, two moments. `scripts/check-env.ts` runs it before the build so a
 * missing or malformed value stops the deploy; `serverEnv()` runs the core part
 * lazily at runtime so a fresh clone can still boot the parts that only need a
 * database.
 *
 * Rules for this module:
 * - Nothing here is imported from a client component, so no value can reach the
 *   browser bundle.
 * - Errors name the variable, never the value. That holds for the format
 *   messages below too, which describe the expected shape rather than quoting
 *   what was found.
 */

/**
 * `vercel env pull` writes this literal for values it is not allowed to hand
 * out. Copying such a file into place is a realistic way to end up with a
 * syntactically fine but functionally dead configuration.
 */
const PULL_PLACEHOLDER = "[SENSITIVE]";

function wellFormed(label: string) {
  return z
    .string()
    .min(1, `${label} is empty`)
    .refine((v) => v !== PULL_PLACEHOLDER, `${label} is the "[SENSITIVE]" placeholder from \`vercel env pull\``)
    .refine((v) => !/\s/.test(v), `${label} contains whitespace`);
}

const postgresUrl = (label: string) =>
  wellFormed(label).refine(
    (v) => /^postgres(ql)?:\/\//.test(v),
    `${label} must start with postgres:// or postgresql://`,
  );

/** Needed wherever the application talks to its own database. */
const coreEnvSchema = z.object({
  DATABASE_URL: postgresUrl("DATABASE_URL"),
  DATABASE_URL_UNPOOLED: postgresUrl("DATABASE_URL_UNPOOLED").optional(),
});

/**
 * Additionally required for a deployed environment.
 *
 * The prefixes were verified against the real values rather than taken from
 * memory. That mattered: Google issues keys in an older `AIza` format and a
 * newer `AQ.` format, and hard-coding only the first would have rejected an
 * intact key and failed the deploy while pointing at the wrong culprit.
 */
const deployEnvSchema = z.object({
  AUTH_SECRET: wellFormed("AUTH_SECRET").refine(
    (v) => v.length >= 32,
    "AUTH_SECRET must be at least 32 characters",
  ),
  AUTH_GITHUB_ID: wellFormed("AUTH_GITHUB_ID").refine(
    (v) => /^(Iv1\.|Ov23)/.test(v),
    "AUTH_GITHUB_ID must be a GitHub OAuth client id (Iv1. or Ov23 prefix)",
  ),
  AUTH_GITHUB_SECRET: wellFormed("AUTH_GITHUB_SECRET").refine(
    (v) => v.length >= 32,
    "AUTH_GITHUB_SECRET must be at least 32 characters",
  ),
  GOOGLE_GENERATIVE_AI_API_KEY: wellFormed("GOOGLE_GENERATIVE_AI_API_KEY").refine(
    (v) => /^(AIza|AQ\.)/.test(v),
    "GOOGLE_GENERATIVE_AI_API_KEY must be a Google API key (AIza or AQ. prefix)",
  ),
  BLOB_READ_WRITE_TOKEN: wellFormed("BLOB_READ_WRITE_TOKEN").refine(
    (v) => v.startsWith("vercel_blob_rw_"),
    "BLOB_READ_WRITE_TOKEN must start with vercel_blob_rw_",
  ),
});

export type CoreEnv = z.infer<typeof coreEnvSchema>;

export type EnvProblem = { variable: string; problem: string };

function collect(result: { success: boolean; error?: z.ZodError }): EnvProblem[] {
  if (result.success || !result.error) return [];
  return result.error.issues.map((issue: z.core.$ZodIssue) => ({
    variable: String(issue.path[0] ?? "unknown"),
    problem: issue.message,
  }));
}

/** Problems in the variables every environment needs. */
export function checkCoreEnv(source: NodeJS.ProcessEnv = process.env): EnvProblem[] {
  return collect(coreEnvSchema.safeParse(source));
}

/** Problems in the variables a deployed environment additionally needs. */
export function checkDeployEnv(source: NodeJS.ProcessEnv = process.env): EnvProblem[] {
  return collect(deployEnvSchema.safeParse(source));
}

let cached: CoreEnv | null = null;

export function serverEnv(): CoreEnv {
  if (cached) return cached;

  const parsed = coreEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const detail = collect(parsed)
      .map((p) => `${p.variable}: ${p.problem}`)
      .join("; ");
    throw new Error(`Invalid environment: ${detail}`);
  }

  cached = parsed.data;
  return cached;
}
