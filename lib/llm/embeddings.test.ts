import { describe, expect, it } from "vitest";
import { EmbeddingError, normalise } from "@/lib/llm/embeddings";

describe("normalise", () => {
  it("scales a vector to unit length", () => {
    const result = normalise([3, 4]);
    expect(result).toEqual([0.6, 0.8]);
    expect(Math.hypot(...result)).toBeCloseTo(1, 12);
  });

  it("leaves an already normalised vector unchanged", () => {
    const unit = [1, 0, 0];
    expect(normalise(unit)).toEqual(unit);
  });

  it("preserves direction, so ranking cannot change", () => {
    const original = [2, -4, 6];
    const scaled = normalise(original);
    const factor = scaled[0]! / original[0]!;
    for (let i = 0; i < original.length; i += 1) {
      expect(scaled[i]).toBeCloseTo(original[i]! * factor, 12);
    }
  });

  it("refuses a zero vector rather than producing NaN", () => {
    expect(() => normalise([0, 0, 0])).toThrow(EmbeddingError);
  });
});
