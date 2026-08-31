import { auth } from "@/auth";
import { userIdFromSession, type UserId } from "@/lib/db/user-id";

/**
 * The bridge between authentication and data access.
 *
 * This is the only place where a session turns into a `UserId`, the branded type
 * every function in the access layer demands. A route handler that skips the
 * check has no way to produce one and will not compile, which is what keeps
 * "did we remember to authenticate this endpoint" from being a review question.
 */
export async function currentUserId(): Promise<UserId | null> {
  const session = await auth();
  const id = session?.user?.id;
  return id ? userIdFromSession(id) : null;
}
