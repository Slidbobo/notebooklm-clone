import { z } from "zod";
import { currentUserId } from "@/lib/auth/session";
import { appendMessage, getNotebook, saveCitations, searchChunks } from "@/lib/db/access";
import { extractCitedChunkIds, renderAnswer, streamAnswer } from "@/lib/llm/chat";
import { MIN_SIMILARITY, RETRIEVAL_LIMIT } from "@/lib/llm/config";
import { REFUSAL_MARKER, REFUSAL_TEXT, type SourceChunk } from "@/lib/llm/prompt";
import { embedQuery } from "@/lib/llm/embeddings";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  notebookId: z.string().uuid(),
  question: z.string().trim().min(1).max(1_000),
});

/**
 * Streams an answer for one question in one notebook.
 *
 * The response is a plain text stream with one JSON line of metadata in front of
 * it, terminated by a newline. The client reads that line to learn which sources
 * the answer may cite, then renders the rest as it arrives. A framing this
 * simple avoids putting a source list into a response header, where it would
 * collide with size limits.
 */
export async function POST(request: Request) {
  const userId = await currentUserId();
  if (!userId) return json({ error: "Nicht angemeldet." }, 401);

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) return json({ error: "Ungültige Anfrage." }, 400);

  const { notebookId, question } = parsed.data;

  // A notebook that belongs to someone else is indistinguishable from one that
  // does not exist, here as everywhere else.
  const notebook = await getNotebook(userId, notebookId);
  if (!notebook) return json({ error: "Notebook nicht gefunden." }, 404);

  const queryVector = await embedQuery(question);
  const hits = await searchChunks(userId, notebookId, queryVector, RETRIEVAL_LIMIT);

  // The floor is what makes refusal possible at all: top-k always returns
  // something, so without it the system would answer every question from
  // whatever was least unrelated. See MIN_SIMILARITY for the calibration.
  const usable: SourceChunk[] = hits
    .filter((hit) => hit.similarity >= MIN_SIMILARITY)
    .map((hit) => ({
      id: hit.id,
      filename: hit.filename,
      content: hit.content,
      charStart: hit.charStart,
      charEnd: hit.charEnd,
      similarity: hit.similarity,
    }));

  await appendMessage(userId, { notebookId, role: "user", content: question });

  if (usable.length === 0) {
    // Answered without calling the model: the outcome is already determined, and
    // spending quota to be told so would be waste.
    const message = await appendMessage(userId, {
      notebookId,
      role: "assistant",
      content: REFUSAL_TEXT,
    });
    return streamOf({ messageId: message?.id ?? null, sources: [] }, REFUSAL_TEXT);
  }

  const result = streamAnswer(question, usable);
  const sources = usable.map((chunk, index) => ({
    position: index + 1,
    chunkId: chunk.id,
    filename: chunk.filename,
    charStart: chunk.charStart,
    charEnd: chunk.charEnd,
  }));

  const encoder = new TextEncoder();
  let full = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(`${JSON.stringify({ sources })}\n`));

      // The model signals a refusal with a bare marker, which is machine
      // readable but not something to show anybody. Emission is held back until
      // enough characters have arrived to tell a refusal from an answer, so the
      // marker never reaches the client and the user sees the sentence instead.
      let held = "";
      let releasing = false;

      try {
        for await (const delta of result.textStream) {
          full += delta;

          if (releasing) {
            controller.enqueue(encoder.encode(delta));
            continue;
          }

          held += delta;
          if (held.startsWith(REFUSAL_MARKER)) break;
          // Still ambiguous while the text so far could still become the marker.
          if (REFUSAL_MARKER.startsWith(held)) continue;

          releasing = true;
          controller.enqueue(encoder.encode(held));
        }
      } catch (error) {
        console.error("[chat] stream failed", error);
        controller.enqueue(encoder.encode("\n\nDie Antwort wurde unterbrochen."));
      }

      if (full.includes(REFUSAL_MARKER)) {
        controller.enqueue(encoder.encode(REFUSAL_TEXT));
      } else if (!releasing && held.length > 0) {
        // Short answer that never grew past the ambiguous prefix.
        controller.enqueue(encoder.encode(held));
      }

      // Persisted after the stream, because the citations only exist once the
      // model has produced them.
      const rendered = renderAnswer(full);
      const message = await appendMessage(userId, {
        notebookId,
        role: "assistant",
        content: rendered,
      });
      if (message) {
        await saveCitations(userId, message.id, extractCitedChunkIds(rendered, usable));
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function streamOf(metadata: unknown, text: string) {
  const body = `${JSON.stringify(metadata)}\n${text}`;
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
