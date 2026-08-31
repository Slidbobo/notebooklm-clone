import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUserId } from "@/lib/auth/session";
import { getSource } from "@/lib/db/access";
import { HighlightedText } from "./highlighted-text";

type Params = { id: string; sourceId: string };
type Search = { from?: string; to?: string };

/**
 * The extracted text of one source, with the cited passage highlighted.
 *
 * Deliberately not a PDF viewer with a positional overlay. What is shown is the
 * exact text the answer was grounded in, which is the text the chunks carry
 * offsets into, so the highlight cannot drift away from what the model actually
 * read.
 */
export default async function SourcePage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<Search>;
}) {
  const { id, sourceId } = await params;
  const { from, to } = await searchParams;

  const userId = await currentUserId();
  if (!userId) notFound();

  const source = await getSource(userId, sourceId);
  if (!source || source.notebookId !== id) notFound();

  const text = source.extractedText ?? "";
  const start = clamp(Number(from), text.length);
  const end = clamp(Number(to), text.length);

  return (
    <main className="mx-auto flex min-h-svh max-w-3xl flex-col gap-6 px-6 py-12">
      <div className="space-y-2">
        <Link href={`/notebooks/${id}`} className="text-sm text-muted-foreground hover:underline">
          Zurück zum Notebook
        </Link>
        <h1 className="font-heading text-xl font-semibold tracking-tight">{source.filename}</h1>
        <p className="text-sm text-muted-foreground">
          Extrahierter Text, {text.length.toLocaleString("de-DE")} Zeichen
        </p>
      </div>

      {text.length === 0 ? (
        <p className="text-muted-foreground">Für diese Quelle liegt kein extrahierter Text vor.</p>
      ) : (
        <HighlightedText text={text} start={start} end={end} />
      )}
    </main>
  );
}

/** Offsets come from the URL, so they are treated as untrusted input. */
function clamp(value: number, max: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.min(Math.trunc(value), max);
}
