import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import GitHub from "next-auth/providers/github";
import { z } from "zod";
import { isDemoAccount } from "@/lib/auth/demo-accounts";
import { verifyPassword } from "@/lib/auth/password";
import { createAuthAdapter, findUserByEmail } from "@/lib/db/auth";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

/**
 * Session strategy.
 *
 * Mixing a credentials provider with OAuth forces JWT sessions for both: Auth.js
 * cannot issue a database session for a login it did not route through the
 * adapter. The `sessions` table therefore stays empty, and a sign-out clears the
 * cookie without the server being able to invalidate an already issued token.
 *
 * Eight hours instead of the default thirty days limits how long a leaked token
 * stays useful. Real server-side invalidation would need either a revocation
 * list checked on every request, or database sessions for OAuth with a second,
 * separate path for the demo logins. Both were out of scope here; the trade-off
 * is stated in the README rather than hidden.
 */
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: createAuthAdapter(),
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_SECONDS },
  pages: { signIn: "/signin" },
  providers: [
    GitHub,
    Credentials({
      id: "demo",
      name: "Demo-Konto",
      credentials: {
        email: { label: "E-Mail", type: "email" },
        password: { label: "Passwort", type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;

        const { email, password } = parsed.data;

        // Checked before the database is touched, so this provider can never
        // become a password login for an arbitrary account.
        if (!isDemoAccount(email)) return null;

        const user = await findUserByEmail(email);
        if (!user) return null;

        const valid = await verifyPassword(password, user.passwordHash);
        if (!valid) return null;

        return { id: user.id, email: user.email, name: user.name };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.sub = user.id;
      return token;
    },
    session({ session, token }) {
      // Everything downstream derives tenant identity from this one value.
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
});
