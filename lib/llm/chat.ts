import { google } from "@ai-sdk/google";
import { streamText } from "ai";
import { CHAT_MODEL } from "@/lib/llm/config";
import { REFUSAL_MARKER, REFUSAL_TEXT, buildChatPrompt, type SourceChunk } from "@/lib/llm/prompt";

/**
 * Turns retrieved chunks into a streamed, source-bound answer.
 *
 * The retrieval and the tenant filter happen before this function is called;
 * what arrives here is already scoped to one account and one notebook.
 */
export function streamAnswer(question: string, chunks: SourceChunk[]) {
  const { system, user } = buildChatPrompt(question, chunks);

  return streamText({
    model: google(CHAT_MODEL),
    system,
    prompt: user,
    // Low, not zero: the answer should restate the sources, not improvise on
    // them, and a deterministic setting also makes the eval runs comparable.
    temperature: 0.1,
  });
}

/**
 * Extracts the source numbers an answer cited and maps them back to chunk ids.
 *
 * Numbers the model invented are dropped rather than trusted: only positions
 * that exist in the retrieval result can produce a citation row. That is also
 * what makes a prompt injection visible instead of effective, because an
 * injected instruction cannot supply a valid citation for its own output.
 */
export function extractCitedChunkIds(answer: string, chunks: SourceChunk[]): string[] {
  const cited = new Set<string>();

  for (const match of answer.matchAll(/\[(\d{1,2})\]/g)) {
    const position = Number(match[1]);
    const chunk = chunks[position - 1];
    if (chunk) cited.add(chunk.id);
  }

  return [...cited];
}

/**
 * Replaces the bare refusal marker with the sentence shown to the user.
 *
 * The model is asked for a marker rather than a sentence so that the refusal is
 * machine-detectable in the eval runs and cannot drift in wording between
 * answers.
 */
export function renderAnswer(raw: string): string {
  return raw.includes(REFUSAL_MARKER) ? REFUSAL_TEXT : raw;
}

export { REFUSAL_MARKER, REFUSAL_TEXT };
export type { SourceChunk };
