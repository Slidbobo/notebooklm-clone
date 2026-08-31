import { get } from "@vercel/blob";
import {
  countSources,
  deleteChunksForSource,
  getSource,
  insertChunks,
  saveExtractedText,
  updateSourceStatus,
} from "@/lib/db/access";
import type { UserId } from "@/lib/db/user-id";
import { chunkText } from "@/lib/ingestion/chunk";
import { ExtractionError, extractDocumentText } from "@/lib/ingestion/extract";
import { MAX_SOURCES_PER_NOTEBOOK, isAcceptedMimeType } from "@/lib/ingestion/limits";
import { EmbeddingError, embedTexts } from "@/lib/llm/embeddings";

export type IngestResult =
  | { status: "ready"; chunks: number }
  | { status: "failed"; message: string };

/**
 * Runs a source from uploaded blob to searchable chunks, synchronously.
 *
 * Every step goes through the tenant-scoped access layer, so an ingestion can
 * only ever touch a source the caller owns. Status is written before each step
 * rather than after, so a run that dies mid-way leaves the source visibly stuck
 * in that step instead of silently pending.
 *
 * Failures are recorded on the source and returned as a message meant for the
 * person who uploaded the file. Provider errors are logged, never forwarded.
 */
export async function ingestSource(userId: UserId, sourceId: string): Promise<IngestResult> {
  const source = await getSource(userId, sourceId);
  if (!source) return { status: "failed", message: "Quelle nicht gefunden." };

  try {
    if (!isAcceptedMimeType(source.mimeType)) {
      throw new ExtractionError("Nur PDF- und TXT-Dateien werden unterstützt.");
    }

    await updateSourceStatus(userId, sourceId, "extracting");
    const bytes = await readBlob(source.blobPathname);
    const text = await extractDocumentText(bytes, source.mimeType);
    await saveExtractedText(userId, sourceId, text);

    const chunkCount = await embedIntoChunks(userId, sourceId, source.notebookId, text);
    return { status: "ready", chunks: chunkCount };
  } catch (error) {
    const message =
      error instanceof ExtractionError || error instanceof EmbeddingError
        ? error.message
        : "Die Verarbeitung ist fehlgeschlagen.";

    if (!(error instanceof ExtractionError) && !(error instanceof EmbeddingError)) {
      console.error("[ingestion] unexpected failure", error);
    }

    await updateSourceStatus(userId, sourceId, "failed", message);
    return { status: "failed", message };
  }
}

/**
 * Chunks text and stores it with embeddings. Shared by the upload flow and the
 * seed script, which already holds the text and has no blob to download.
 */
export async function embedIntoChunks(
  userId: UserId,
  sourceId: string,
  notebookId: string,
  text: string,
): Promise<number> {
  await updateSourceStatus(userId, sourceId, "embedding");
  // A retry must not stack a second set of chunks on top of the first.
  await deleteChunksForSource(userId, sourceId);

  const pieces = chunkText(text);
  if (pieces.length === 0) {
    throw new ExtractionError("Die Datei enthält keinen verwertbaren Text.");
  }

  const vectors = await embedTexts(
    pieces.map((piece) => piece.content),
    "RETRIEVAL_DOCUMENT",
  );

  await insertChunks(
    userId,
    pieces.map((piece, index) => ({
      sourceId,
      notebookId,
      content: piece.content,
      charStart: piece.charStart,
      charEnd: piece.charEnd,
      embedding: vectors[index]!,
    })),
  );

  await updateSourceStatus(userId, sourceId, "ready");
  return pieces.length;
}

/**
 * Reads an uploaded file out of the private blob store.
 *
 * The store is private, so there is no URL anyone can fetch. The bytes are read
 * server side with the store credential, which means an uploaded document is
 * never reachable without going through this application. User-facing file
 * access gets short-lived signed URLs after an ownership check; the citation
 * view does not need them, because it renders the extracted text held in the
 * database rather than the original file.
 */
async function readBlob(pathname: string): Promise<ArrayBuffer> {
  const result = await get(pathname, {
    access: "private",
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });

  if (!result || result.statusCode !== 200 || !result.stream) {
    console.error("[ingestion] blob read returned", result?.statusCode ?? "null");
    throw new ExtractionError("Die hochgeladene Datei konnte nicht gelesen werden.");
  }

  return new Response(result.stream).arrayBuffer();
}

/** True when the notebook has room for another source. */
export async function hasQuota(userId: UserId, notebookId: string): Promise<boolean> {
  return (await countSources(userId, notebookId)) < MAX_SOURCES_PER_NOTEBOOK;
}
