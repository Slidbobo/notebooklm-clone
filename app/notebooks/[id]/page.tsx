import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUserId } from "@/lib/auth/session";
import { getNotebook, listCitations, listMessages, listSources } from "@/lib/db/access";
import { MAX_SOURCES_PER_NOTEBOOK } from "@/lib/ingestion/limits";
import { ChatPanel, type ChatMessage } from "./chat-panel";
import { DeleteNotebookButton } from "./delete-notebook-button";
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
  const history = await listMessages(userId, notebook.id);
  const citationRows = await listCitations(
    userId,
    history.map((message) => message.id),
  );

  // Positions are assigned per message in the order the citations were stored,
  // which mirrors the numbering the answer used.
  const citationsByMessage = new Map<string, ChatMessage["citations"]>();
  const sourceIdByChunk: Record<string, string> = {};
  for (const row of citationRows) {
    sourceIdByChunk[row.chunkId] = row.sourceId;
    const existing = citationsByMessage.get(row.messageId) ?? [];
    existing.push({
      position: existing.length + 1,
      chunkId: row.chunkId,
      sourceId: row.sourceId,
      filename: row.filename,
      charStart: row.charStart,
      charEnd: row.charEnd,
    });
    citationsByMessage.set(row.messageId, existing);
  }

  const messages: ChatMessage[] = history.map((message) => ({
    id: message.id,
    role: message.role,
    content: message.content,
    citations: citationsByMessage.get(message.id) ?? [],
  }));

  return (
    <main className="mx-auto flex min-h-svh max-w-3xl flex-col gap-8 px-6 py-12">
      <header className="space-y-3">
        <Link href="/" className="text-sm text-muted-foreground hover:underline">
          Zurück zur Übersicht
        </Link>
        <div className="flex items-start justify-between gap-4">
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{notebook.title}</h1>
          <DeleteNotebookButton notebookId={notebook.id} />
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

      <ChatPanel
        notebookId={notebook.id}
        initialMessages={messages}
        sourceIdByChunk={sourceIdByChunk}
        ready={sources.some((source) => source.status === "ready")}
      />
    </main>
  );
}
