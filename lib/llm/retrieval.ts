import { searchChunks } from "@/lib/db/access";
import type { UserId } from "@/lib/db/user-id";
import { MIN_SIMILARITY, RETRIEVAL_LIMIT } from "@/lib/llm/config";
import { embedQuery } from "@/lib/llm/embeddings";
import type { SourceChunk } from "@/lib/llm/prompt";

export type RetrievalResult = {
  usable: SourceChunk[];
  /** Everything the search returned, including what the floor rejected. */
  considered: { filename: string; similarity: number }[];
};

/**
 * Retrieval plus the similarity floor, shared by the chat endpoint and the eval
 * runner.
 *
 * Shared on purpose: an eval that exercises its own copy of the pipeline
 * measures the copy. The tenant filter lives inside searchChunks, so both paths
 * inherit it without either having to remember.
 */
export async function retrieveContext(
  userId: UserId,
  notebookId: string,
  question: string,
): Promise<RetrievalResult> {
  const queryVector = await embedQuery(question);
  const hits = await searchChunks(userId, notebookId, queryVector, RETRIEVAL_LIMIT);

  return {
    usable: hits
      .filter((hit) => hit.similarity >= MIN_SIMILARITY)
      .map((hit) => ({
        id: hit.id,
        filename: hit.filename,
        content: hit.content,
        charStart: hit.charStart,
        charEnd: hit.charEnd,
        similarity: hit.similarity,
      })),
    considered: hits.map((hit) => ({ filename: hit.filename, similarity: hit.similarity })),
  };
}
