import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { accounts, sessions, users } from "@/lib/db/schema";

/**
 * Database access for authentication.
 *
 * Lives inside `lib/db` because it needs the raw handle: establishing who
 * somebody is happens before there is a tenant to scope to, so none of these
 * functions can take a `UserId`. Everything that runs after sign-in goes through
 * `lib/db/access.ts` instead.
 */
export function createAuthAdapter() {
  return DrizzleAdapter(getDb(), {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
  });
}

export type CredentialsUser = {
  id: string;
  email: string;
  name: string | null;
  passwordHash: string | null;
};

/** Looks up a single account by address. Returns null rather than throwing. */
export async function findUserByEmail(email: string): Promise<CredentialsUser | null> {
  const [found] = await getDb()
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (!found?.email) return null;
  return { id: found.id, email: found.email, name: found.name, passwordHash: found.passwordHash };
}
