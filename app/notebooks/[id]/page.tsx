import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUserId } from "@/lib/auth/session";
import { getNotebook, listSources } from "@/lib/db/access";
import { MAX_SOURCES_PER_NOTEBOOK } from "@/lib/ingestion/limits";
import { Button } from "@/components/ui/button";
import { deleteNotebookAction } from "../actions";
import { SourcePanel } from "./source-panel";

export default async function NotebookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  // Not signed in and "not yours" both end here. A foreign notebook is
  // indistinguishable from one that does not exist.
  if (!userId) notFound();

  const notebook = await getNotebook(userId, id);
  if (!notebook) notFound();

  const sources = await listSources(userId, notebook.id);

  return (
    <main className="mx-auto flex min-h-svh max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="space-y-3">
        <Link href="/" className="text-sm text-muted-foreground hover:underline">
          Zurück zur Übersicht
        </Link>
        <div className="flex items-start justify-between gap-4">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{notebook.title}</h1>
          <form action={deleteNotebookAction}>
            <input type="hidden" name="id" value={notebook.id} />
            <Button variant="outline" size="sm" type="submit">
              Notebook löschen
            </Button>
          </form>
        </div>
        <p className="text-sm text-muted-foreground">
          {sources.length} von {MAX_SOURCES_PER_NOTEBOOK} Quellen
        </p>
      </header>

      <SourcePanel
        notebookId={notebook.id}
        initialSources={sources.map((source) => ({
          id: source.id,
          filename: source.filename,
          status: source.status,
          statusMessage: source.statusMessage,
        }))}
      />
    </main>
  );
}
