/**
 * Splits extracted text into overlapping chunks with character positions.
 *
 * The positions are not decoration: a citation jumps into the extracted text
 * view and highlights exactly `text.slice(charStart, charEnd)`. If an offset is
 * off by one the highlight is visibly wrong, which is why the invariant is
 * asserted in the tests rather than assumed.
 *
 * Splitting prefers paragraph breaks, then sentence ends, then a hard cut, so a
 * chunk usually stops at a boundary a reader would recognise. The overlap keeps
 * a statement that straddles a boundary retrievable from either side.
 */
const TARGET_CHARS = 1_000;
const OVERLAP_CHARS = 150;
const MIN_CHARS = 200;

export type Chunk = {
  content: string;
  charStart: number;
  charEnd: number;
};

export function chunkText(
  text: string,
  options: { targetChars?: number; overlapChars?: number } = {},
): Chunk[] {
  const target = options.targetChars ?? TARGET_CHARS;
  const overlap = Math.min(options.overlapChars ?? OVERLAP_CHARS, Math.floor(target / 2));

  if (text.trim().length === 0) return [];

  const chunks: Chunk[] = [];
  let start = 0;

  while (start < text.length) {
    const hardEnd = Math.min(start + target, text.length);
    const end = hardEnd === text.length ? hardEnd : findBoundary(text, start, hardEnd);

    const content = text.slice(start, end);
    if (content.trim().length > 0) {
      chunks.push({ content, charStart: start, charEnd: end });
    }

    if (end >= text.length) break;

    // Step forward by at least one character so a boundary that lands on the
    // window start cannot spin the loop.
    const next = Math.max(start + 1, end - overlap);
    start = next;
  }

  return chunks;
}

/**
 * Looks backwards from the hard cut for a boundary a reader would recognise,
 * but never accepts one that would make the chunk uselessly short.
 */
function findBoundary(text: string, start: number, hardEnd: number): number {
  const earliest = start + MIN_CHARS;
  const window = text.slice(start, hardEnd);

  const paragraph = window.lastIndexOf("\n\n");
  if (paragraph >= 0 && start + paragraph + 2 > earliest) return start + paragraph + 2;

  const sentence = Math.max(
    window.lastIndexOf(". "),
    window.lastIndexOf(".\n"),
    window.lastIndexOf("! "),
    window.lastIndexOf("? "),
  );
  if (sentence >= 0 && start + sentence + 2 > earliest) return start + sentence + 2;

  const space = window.lastIndexOf(" ");
  if (space >= 0 && start + space + 1 > earliest) return start + space + 1;

  return hardEnd;
}
