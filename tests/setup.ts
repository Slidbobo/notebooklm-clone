import { config } from "dotenv";

// Local runs read .env.local. CI injects DATABASE_URL directly, and dotenv does
// not overwrite variables that are already set.
config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is not set. Start a local database with `docker compose up -d` " +
      "and copy .env.example to .env.local, or run the suite in CI.",
  );
}
