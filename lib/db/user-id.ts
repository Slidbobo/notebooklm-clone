/**
 * A user id that has been established by the server.
 *
 * The brand is a compile-time marker with no runtime representation. It exists
 * so that every function in the access layer can demand a `UserId` rather than a
 * `string`: a notebook id, a filename or a value read straight from the request
 * body will not type check in that position. The only way to obtain one is
 * `userIdFromSession`, which is called with the id Auth.js resolved from the
 * signed session token.
 */
declare const userIdBrand: unique symbol;

export type UserId = string & { readonly [userIdBrand]: "UserId" };

/**
 * The single entry point that turns a session subject into a `UserId`.
 *
 * Deliberately the only cast in the codebase. Keeping it in one named function
 * means an audit of "where does tenant identity come from" is a search for one
 * symbol rather than a review of every query.
 */
export function userIdFromSession(sessionUserId: string): UserId {
  if (!sessionUserId) {
    throw new Error("Cannot derive a UserId from an empty session subject");
  }
  return sessionUserId as UserId;
}

/**
 * Second and last cast in the codebase, reserved for the offline seed script.
 *
 * The seed runs from a shell against a database the operator already controls
 * and knows the account ids authoritatively; there is no session to derive them
 * from. It is a separate named function rather than a reuse of
 * `userIdFromSession` so that "who is allowed to mint a tenant identity" stays a
 * search for two symbols with two different, stated justifications.
 */
export function trustedUserIdForSeed(userId: string): UserId {
  if (!userId) {
    throw new Error("Cannot derive a UserId from an empty id");
  }
  return userId as UserId;
}
