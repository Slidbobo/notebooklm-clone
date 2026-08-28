import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

/**
 * Forbids reaching past the tenant-scoped access layer.
 *
 * TypeScript can force every access-layer function to demand a branded `UserId`,
 * but it has no way to express "this module may only be imported from that
 * directory". Without this rule a route handler could import the raw database
 * handle or the driver and write a query with no owner filter, and nothing would
 * complain. `tests/access-layer-boundary.test.ts` lints a deliberate violation
 * to prove the rule still fires.
 */
const databaseBoundary = {
  name: "database-access-boundary",
  files: ["**/*.ts", "**/*.tsx"],
  // lib/db is the inside of the boundary. Tests are allowed under it on
  // purpose: they set up cross-tenant fixtures in order to verify from the
  // outside that the boundary holds. scripts/ is the seed, which runs offline
  // against a database the operator already controls.
  ignores: ["lib/db/**", "drizzle.config.ts", "scripts/**", "tests/**"],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "postgres",
            message:
              "Do not open database connections outside lib/db. Use the access layer in lib/db/access.ts.",
          },
          {
            name: "drizzle-orm/postgres-js",
            message:
              "Do not construct a Drizzle instance outside lib/db. Use the access layer in lib/db/access.ts.",
          },
        ],
        patterns: [
          {
            group: ["@/lib/db/client", "**/lib/db/client", "../client", "./client"],
            message:
              "lib/db/client is internal to lib/db. Every read and write goes through lib/db/access.ts, which requires a UserId and puts the tenant filter into the query itself.",
          },
        ],
      },
    ],
  },
};

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts"],
  },
  databaseBoundary,
];

export default eslintConfig;
