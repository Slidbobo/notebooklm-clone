import { auth } from "@/auth";
import { isDemoAccount } from "@/lib/auth/demo-accounts";
import { userIdFromSession, type UserId } from "@/lib/db/user-id";

export type Account = {
  userId: UserId;
  email: string | null;
  isDemo: boolean;
};

/**
 * The bridge between authentication and data access.
 *
 * This is the only place where a session turns into a `UserId`, the branded type
 * every function in the access layer demands. A route handler that skips the
 * check has nothing to pass and will not compile, which is what keeps "did we
 * remember to authenticate this endpoint" from being a review question.
 */
export async function currentAccount(): Promise<Account | null> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) return null;

  const email = session.user.email ?? null;
  return {
    userId: userIdFromSession(id),
    email,
    isDemo: email ? isDemoAccount(email) : false,
  };
}

export async function currentUserId(): Promise<UserId | null> {
  return (await currentAccount())?.userId ?? null;
}
