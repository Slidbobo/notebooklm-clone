/**
 * The only two addresses the credentials provider will ever consider.
 *
 * The allowlist is checked before the database is touched, so the provider
 * cannot be turned into a password login for arbitrary accounts, and in
 * particular not for a GitHub user who happens to share an address. Those
 * accounts have no password hash and would fail verification anyway; the
 * allowlist makes that a property of the configuration rather than of the data.
 *
 * These credentials are published in the README on purpose, so treating the
 * addresses as secret would be theatre. They are listed here to bound what the
 * provider can do, not to hide anything.
 */
export const DEMO_ACCOUNT_EMAILS = ["demo-a@example.com", "demo-b@example.com"] as const;

export function isDemoAccount(email: string): boolean {
  return (DEMO_ACCOUNT_EMAILS as readonly string[]).includes(email);
}
