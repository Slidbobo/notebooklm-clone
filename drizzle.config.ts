import { defineConfig } from "drizzle-kit";
import "dotenv/config";

// Migrations run over the direct (unpooled) connection. PgBouncer in
// transaction mode cannot execute the DDL statements drizzle-kit emits.
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) {
  throw new Error("Missing environment variable: DATABASE_URL_UNPOOLED or DATABASE_URL");
}

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
