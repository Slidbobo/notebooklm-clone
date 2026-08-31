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

/** Embedding model. Fixed by the briefing; see docs/decisions.md for the check. */
export const EMBEDDING_MODEL = "gemini-embedding-001";

/**
 * Chat model. Flash-Lite is the cheapest tier that still follows a strict system
 * prompt reliably.
 *
 * Not 2.5: that generation is still listed by the models endpoint but the API
 * refuses it for new keys with "no longer available to new users". Being listed
 * and being usable are different things, which is why the build check makes an
 * actual one-token call instead of trusting the catalogue.
 */
export const CHAT_MODEL = "gemini-3.5-flash-lite";

/**
 * Embedding requests per call. The provider accepts batches, and a single
 * request per chunk would exhaust the free-tier request-per-minute limit on any
 * document worth uploading.
 */
export const EMBEDDING_BATCH_SIZE = 32;

/**
 * Minimum cosine similarity for a chunk to count as a usable source.
 *
 * Calibrated, not guessed. Eight questions that the seed documents clearly
 * answer scored between 0.728 and 0.774. Six questions that they clearly do not
 * answer, including two aimed at the other account's subject matter, scored
 * between 0.468 and 0.543. The gap is 0.185 wide and 0.65 sits inside it, with
 * 0.107 of margin above the strongest false positive and 0.078 below the
 * weakest true positive. The asymmetry is deliberate: answering from a weak
 * match is a worse failure here than declining a question that was answerable.
 *
 * Without a floor, top-k retrieval always returns something, and the system
 * would answer every question from whatever was least unrelated.
 */
export const MIN_SIMILARITY = 0.65;

/** Chunks fed to the model per answer. */
export const RETRIEVAL_LIMIT = 8;
