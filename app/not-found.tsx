import Link from "next/link";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Seite nicht gefunden" };

/**
 * The page every unauthorised access lands on.
 *
 * The wording carries a security decision. A notebook belonging to somebody else
 * and a notebook that never existed produce exactly this page, so the text must
 * not hint at which of the two happened. "Kein Zugriff" would confirm that the
 * id is real, which is the information the 404-instead-of-403 rule exists to
 * withhold.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-6 px-6 py-16">
      <div className="space-y-3">
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">404</p>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">
          Diese Seite gibt es nicht
        </h1>
        <p className="text-balance text-muted-foreground">
          Die Adresse führt ins Leere. Möglicherweise ist der Link veraltet oder
          enthält einen Tippfehler.
        </p>
      </div>
      <Button asChild className="w-fit">
        <Link href="/">Zur Notebook-Übersicht</Link>
      </Button>
    </main>
  );
}
