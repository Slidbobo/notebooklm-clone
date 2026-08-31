import { google } from "@ai-sdk/google";
import { embedMany } from "ai";
import { EMBEDDING_BATCH_SIZE, EMBEDDING_DIMENSIONS, EMBEDDING_MODEL } from "@/lib/llm/config";

export class EmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingError";
  }
}

/**
 * Scales a vector to unit length.
 *
 * gemini-embedding-001 returns unit-length vectors only at its full width of
 * 3072. Asking for 1536 truncates, and a truncated vector is no longer
 * normalised. Cosine distance in pgvector does normalise internally, so search
 * would still rank correctly, but stored vectors of differing magnitude make
 * every other operation on them, averaging, thresholding, comparing scores
 * across documents, quietly wrong. Normalising once at write time keeps the
 * stored representation honest.
 */
export function normalise(vector: number[]): number[] {
  let sumOfSquares = 0;
  for (const value of vector) sumOfSquares += value * value;

  const magnitude = Math.sqrt(sumOfSquares);
  if (magnitude === 0) {
    throw new EmbeddingError("Provider returned a zero vector, which cannot be normalised");
  }

  return vector.map((value) => value / magnitude);
}

type TaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

/**
 * Embeds a list of texts.
 *
 * The task type matters for retrieval quality: the provider embeds a stored
 * passage and a user's question into the same space but optimises them
 * differently, so documents and queries must not be embedded with the same
 * setting.
 */
export async function embedTexts(texts: string[], taskType: TaskType): Promise<number[][]> {
  if (texts.length === 0) return [];

  const model = google.embedding(EMBEDDING_MODEL);
  const vectors: number[][] = [];

  for (let offset = 0; offset < texts.length; offset += EMBEDDING_BATCH_SIZE) {
    const batch = texts.slice(offset, offset + EMBEDDING_BATCH_SIZE);
    try {
      const { embeddings } = await embedMany({
        model,
        values: batch,
        providerOptions: {
          google: { outputDimensionality: EMBEDDING_DIMENSIONS, taskType },
        },
      });

      for (const embedding of embeddings) {
        if (embedding.length !== EMBEDDING_DIMENSIONS) {
          throw new EmbeddingError(
            `Provider returned ${embedding.length} dimensions, expected ${EMBEDDING_DIMENSIONS}`,
          );
        }
        vectors.push(normalise(embedding));
      }
    } catch (error) {
      if (error instanceof EmbeddingError) throw error;
      console.error("[llm] embedding batch failed", error);
      throw new EmbeddingError("Der Embedding-Dienst hat die Anfrage abgelehnt.");
    }
  }

  return vectors;
}

/** Embeds one search query. Separate function so the task type cannot be passed wrongly. */
export async function embedQuery(query: string): Promise<number[]> {
  const [vector] = await embedTexts([query], "RETRIEVAL_QUERY");
  if (!vector) throw new EmbeddingError("Der Embedding-Dienst hat keinen Vektor geliefert.");
  return vector;
}
