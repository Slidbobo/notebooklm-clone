"use client";

import { useEffect, useRef } from "react";

/**
 * Renders the extracted text and marks the cited range.
 *
 * The range is applied by slicing at the character offsets the chunk carries.
 * That is the same arithmetic the chunker is tested on, so a highlight sitting
 * in the wrong place would mean the stored offsets are wrong, not that the view
 * approximated something.
 */
export function HighlightedText({
  text,
  start,
  end,
}: {
  text: string;
  start: number | null;
  end: number | null;
}) {
  const markRef = useRef<HTMLElement>(null);
  const hasRange = start !== null && end !== null && end > start;

  useEffect(() => {
    markRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [start, end]);

  if (!hasRange) {
    return <article className="whitespace-pre-wrap text-sm leading-relaxed">{text}</article>;
  }

  return (
    <article className="whitespace-pre-wrap text-sm leading-relaxed">
      {text.slice(0, start)}
      <mark
        ref={markRef}
        className="rounded bg-yellow-200 px-0.5 py-0.5 text-foreground dark:bg-yellow-500/30"
      >
        {text.slice(start, end)}
      </mark>
      {text.slice(end)}
    </article>
  );
}
