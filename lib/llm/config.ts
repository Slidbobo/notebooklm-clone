/**
 * Model configuration for the whole application.
 *
 * Every call to an LLM or embedding provider goes through `lib/llm/`. This file
 * holds the values that a provider switch would have to change, so that the
 * blast radius of swapping Gemini for something else is one directory.
 */

/**
 * Width of the stored embedding vectors.
 *
 * gemini-embedding-001 emits 3072 dimensions by default and supports Matryoshka
 * truncation to smaller widths, with 768, 1536 and 3072 documented as the
 * recommended choices. 3072 is not usable here: pgvector stores up to 16000
 * dimensions but indexes only up to 2000 with both HNSW and IVFFlat, so a 3072
 * wide column would force a sequential scan on every search.
 *
 * 1536 is the widest indexable option among the recommended values and is what
 * the schema is built on. Truncated vectors from this model are not unit length,
 * so the embedding module normalises them before they are stored or compared.
 */
export const EMBEDDING_DIMENSIONS = 1536;
