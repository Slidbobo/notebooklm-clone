import { z } from "zod";

/**
 * Server-side environment access.
 *
 * Validation is lazy and memoised so that a missing optional key never breaks
 * `next build`; it fails at the moment the value is actually needed instead.
 *
 * Rules for this module:
 * - Nothing here is ever imported from a client component. Every consumer runs
 *   on the server, which keeps secrets out of the browser bundle.
 * - Values are never logged, stringified into errors, or echoed back. Errors
 *   report the variable name only.
 */
const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_URL_UNPOOLED: z.string().min(1).optional(),
});

type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) return cached;

  const parsed = serverEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    // Only the variable names are surfaced, never the values.
    const missing = Object.keys(parsed.error.flatten().fieldErrors).join(", ");
    throw new Error(`Invalid or missing environment variables: ${missing}`);
  }

  cached = parsed.data;
  return cached;
}
