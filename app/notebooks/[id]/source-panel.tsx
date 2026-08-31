"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { Button } from "@/components/ui/button";
import { MAX_UPLOAD_BYTES } from "@/lib/ingestion/limits";

export type SourceRow = {
  id: string;
  filename: string;
  status: "pending" | "extracting" | "embedding" | "ready" | "failed";
  statusMessage: string | null;
};

const STATUS_LABEL: Record<SourceRow["status"], string> = {
  pending: "Wartet",
  extracting: "Text wird extrahiert",
  embedding: "Embeddings werden erzeugt",
  ready: "Bereit",
  failed: "Fehlgeschlagen",
};

/** Local phase of an upload, before the server knows the source exists. */
type Pending = { filename: string; phase: "uploading" | "processing" };

export function SourcePanel({
  notebookId,
  initialSources,
}: {
  notebookId: string;
  initialSources: SourceRow[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(file: File) {
    setError(null);

    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`Die Datei ist größer als ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);
      return;
    }

    try {
      setPending({ filename: file.name, phase: "uploading" });

      // Straight to Blob storage. The route only issues a token after checking
      // that this account owns the notebook.
      const blob = await upload(file.name, file, {
        access: "private",
        handleUploadUrl: "/api/blob/upload",
        clientPayload: JSON.stringify({ notebookId }),
        contentType: file.type,
      });

      setPending({ filename: file.name, phase: "processing" });

      const response = await fetch("/api/sources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          notebookId,
          filename: file.name,
          mimeType: file.type,
          blobPathname: blob.pathname,
        }),
      });

      const body = (await response.json()) as { message?: string; error?: string };
      if (!response.ok) setError(body.message ?? body.error ?? "Verarbeitung fehlgeschlagen.");

      router.refresh();
    } catch (cause) {
      console.error("[upload] failed", cause);
      setError("Der Upload wurde abgelehnt. Prüfe Dateityp, Größe und das Kontingent.");
    } finally {
      setPending(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,text/plain,.pdf,.txt"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void onFile(file);
          }}
        />
        <Button onClick={() => inputRef.current?.click()} disabled={pending !== null}>
          {pending ? "Wird verarbeitet" : "Quelle hochladen"}
        </Button>
        <span className="text-sm text-muted-foreground">PDF oder TXT, bis 10 MB</span>
      </div>

      {error ? (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <ul className="divide-y divide-border rounded-lg border border-border">
        {pending ? (
          <li className="flex items-center justify-between gap-4 px-4 py-3">
            <span className="font-medium">{pending.filename}</span>
            <span className="text-sm text-muted-foreground">
              {pending.phase === "uploading" ? "Wird hochgeladen" : "Wird verarbeitet"}
            </span>
          </li>
        ) : null}

        {initialSources.length === 0 && !pending ? (
          <li className="px-4 py-8 text-center text-muted-foreground">
            Noch keine Quellen. Lade ein PDF oder eine Textdatei hoch.
          </li>
        ) : null}

        {initialSources.map((source) => (
          <li key={source.id} className="flex items-start justify-between gap-4 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate font-medium">{source.filename}</p>
              {source.statusMessage ? (
                <p className="mt-1 text-sm text-destructive">{source.statusMessage}</p>
              ) : null}
            </div>
            <span
              className={
                source.status === "ready"
                  ? "shrink-0 text-sm text-muted-foreground"
                  : source.status === "failed"
                    ? "shrink-0 text-sm text-destructive"
                    : "shrink-0 text-sm text-muted-foreground"
              }
            >
              {STATUS_LABEL[source.status]}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
