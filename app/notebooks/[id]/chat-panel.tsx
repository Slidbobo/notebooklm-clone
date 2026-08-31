"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type CitationTarget = {
  position: number;
  chunkId: string;
  sourceId: string;
  filename: string;
  charStart: number;
  charEnd: number;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: CitationTarget[];
};

type StreamMetadata = { sources: CitationTarget[] };

export function ChatPanel({
  notebookId,
  initialMessages,
  ready,
}: {
  notebookId: string;
  initialMessages: ChatMessage[];
  ready: boolean;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function ask(question: string) {
    setError(null);
    setPending(true);
    setMessages((current) => [
      ...current,
      { id: `local-${current.length}`, role: "user", content: question, citations: [] },
      { id: `local-${current.length + 1}`, role: "assistant", content: "", citations: [] },
    ]);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notebookId, question }),
      });

      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Die Anfrage ist fehlgeschlagen.");
      }

      await consume(response.body, (text, sources) => {
        setMessages((current) => {
          const next = [...current];
          const last = next.at(-1);
          if (last) {
            last.content = text;
            // Everything the link needs arrives with the stream, so a fresh
            // notebook renders clickable citations on the first answer.
            last.citations = sources;
          }
          return next;
        });
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Die Anfrage ist fehlgeschlagen.");
      setMessages((current) => current.slice(0, -1));
    } finally {
      setPending(false);
    }
  }

  if (!ready) {
    return (
      <section className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-muted-foreground">
        Sobald mindestens eine Quelle verarbeitet ist, kannst du hier Fragen dazu stellen.
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <h2 className="font-heading text-lg font-semibold tracking-tight">Fragen an dieses Notebook</h2>

      <ol className="space-y-4">
        {messages.map((message) => (
          <li key={message.id} className={message.role === "user" ? "text-right" : ""}>
            <div
              className={
                message.role === "user"
                  ? "inline-block max-w-[85%] rounded-lg bg-accent px-3 py-2 text-left text-sm"
                  : "rounded-lg border border-border px-3 py-2 text-sm"
              }
            >
              <AnswerText message={message} notebookId={notebookId} />
            </div>
          </li>
        ))}
      </ol>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = inputRef.current?.value.trim();
          if (!value) return;
          if (inputRef.current) inputRef.current.value = "";
          void ask(value);
        }}
      >
        <Input ref={inputRef} placeholder="Frage zu den Quellen" maxLength={1000} disabled={pending} />
        <Button type="submit" disabled={pending}>
          {pending ? "Antwortet" : "Fragen"}
        </Button>
      </form>
    </section>
  );
}

/**
 * Renders an answer, turning every [n] marker into a link that jumps into the
 * extracted text of the cited source and highlights the exact passage.
 */
function AnswerText({ message, notebookId }: { message: ChatMessage; notebookId: string }) {
  if (message.role === "user" || message.citations.length === 0) {
    return <span className="whitespace-pre-wrap">{message.content}</span>;
  }

  const byPosition = new Map(message.citations.map((citation) => [citation.position, citation]));
  const parts = message.content.split(/(\[\d{1,2}\])/g);

  return (
    <span className="whitespace-pre-wrap">
      {parts.map((part, index) => {
        const match = /^\[(\d{1,2})\]$/.exec(part);
        const citation = match ? byPosition.get(Number(match[1])) : undefined;
        if (!citation || !citation.sourceId) return <span key={index}>{part}</span>;

        return (
          <Link
            key={index}
            href={`/notebooks/${notebookId}/sources/${citation.sourceId}?from=${citation.charStart}&to=${citation.charEnd}`}
            title={citation.filename}
            className="mx-0.5 rounded bg-accent px-1 text-xs font-medium text-foreground no-underline hover:bg-accent/70"
          >
            {part}
          </Link>
        );
      })}
    </span>
  );
}

/** Reads the metadata line, then streams the answer text as it arrives. */
async function consume(
  body: ReadableStream<Uint8Array>,
  onUpdate: (text: string, sources: StreamMetadata["sources"]) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sources: StreamMetadata["sources"] = [];
  let headerDone = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    if (!headerDone) {
      const newline = buffer.indexOf("\n");
      if (newline === -1) continue;
      sources = (JSON.parse(buffer.slice(0, newline)) as StreamMetadata).sources;
      buffer = buffer.slice(newline + 1);
      headerDone = true;
    }

    onUpdate(buffer, sources);
  }
}
