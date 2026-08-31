import { describe, expect, it } from "vitest";
import { chunkText } from "@/lib/ingestion/chunk";

const paragraph = (n: number) =>
  `Absatz ${n}. ` + "Dieser Satz füllt den Absatz mit genug Text, damit die Grenzen greifen. ".repeat(4);

const document = Array.from({ length: 12 }, (_, i) => paragraph(i)).join("\n\n");

describe("chunkText", () => {
  it("returns nothing for empty input", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n  ")).toEqual([]);
  });

  // The whole citation feature rests on this: what a chunk claims its position
  // is has to be what the source text actually contains at that position.
  it("reports offsets that slice back to the exact chunk content", () => {
    for (const chunk of chunkText(document)) {
      expect(document.slice(chunk.charStart, chunk.charEnd)).toBe(chunk.content);
    }
  });

  it("covers the document without gaps", () => {
    const chunks = chunkText(document);
    expect(chunks[0]?.charStart).toBe(0);
    expect(chunks.at(-1)?.charEnd).toBe(document.length);

    for (let i = 1; i < chunks.length; i += 1) {
      // Each chunk starts before the previous one ended, which is the overlap.
      expect(chunks[i]!.charStart).toBeLessThan(chunks[i - 1]!.charEnd);
    }
  });

  it("overlaps consecutive chunks so a statement on a boundary stays findable", () => {
    const chunks = chunkText(document, { targetChars: 400, overlapChars: 100 });
    expect(chunks.length).toBeGreaterThan(2);

    for (let i = 1; i < chunks.length; i += 1) {
      const shared = chunks[i - 1]!.charEnd - chunks[i]!.charStart;
      expect(shared).toBeGreaterThan(0);
    }
  });

  it("terminates on text without any boundary characters", () => {
    const runOn = "x".repeat(5_000);
    const chunks = chunkText(runOn, { targetChars: 300, overlapChars: 50 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.at(-1)?.charEnd).toBe(runOn.length);
  });

  it("keeps a single short document as one chunk", () => {
    const short = "Ein kurzer Text ohne Absätze.";
    expect(chunkText(short)).toEqual([{ content: short, charStart: 0, charEnd: short.length }]);
  });
});
