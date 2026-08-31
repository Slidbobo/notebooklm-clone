import Link from "next/link";
import { auth, signOut } from "@/auth";
import { listNotebooks } from "@/lib/db/access";
import { currentUserId } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";

/**
 * Phase 1 shell. Proves the whole chain end to end: a session becomes a UserId,
 * and that UserId is the only way to reach data. The notebook list is read
 * through the access layer, so what is shown here is by construction scoped to
 * the signed-in account.
 */
export default async function Home() {
  const session = await auth();
  const userId = await currentUserId();

  if (!userId || !session) {
    return (
      <main className="mx-auto flex min-h-svh max-w-2xl flex-col justify-center gap-6 px-6 py-16">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">NotebookLM Clone</h1>
        <p className="text-balance text-muted-foreground">
          Quellengebundener Dokumenten-Chat mit erzwungener Mandantentrennung.
        </p>
        <Button asChild className="w-fit">
          <Link href="/signin">Anmelden</Link>
        </Button>
      </main>
    );
  }

  const notebooks = await listNotebooks(userId);

  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col gap-8 px-6 py-16">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">Notebooks</h1>
          <p className="text-sm text-muted-foreground">
            Angemeldet als {session.user.email ?? session.user.name ?? "unbekannt"}
          </p>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/signin" });
          }}
        >
          <Button variant="outline" size="sm" type="submit">
            Abmelden
          </Button>
        </form>
      </header>

      {notebooks.length === 0 ? (
        <p className="text-muted-foreground">
          Noch keine Notebooks. Das Anlegen kommt in Phase 2.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {notebooks.map((notebook) => (
            <li key={notebook.id} className="px-4 py-3">
              <span className="font-medium">{notebook.title}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
