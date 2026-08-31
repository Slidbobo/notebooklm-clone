import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      /** The database id of the signed-in account, put here by the session callback. */
      id: string;
    } & DefaultSession["user"];
  }
}
