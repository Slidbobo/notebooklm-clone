import { NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit, rateLimitHeaders } from "@/lib/auth/rate-limit";
import { currentAccount } from "@/lib/auth/session";
import { createSource } from "@/lib/db/access";
import { isAcceptedMimeType } from "@/lib/ingestion/limits";
import { hasQuota, ingestSource } from "@/lib/ingestion/ingest";

export const runtime = "nodejs";
export const maxDuration = 300;

const bodySchema = z.object({
  notebookId: z.string().uuid(),
  filename: z.string().min(1).max(255),
  mimeType: z.string().refine(isAcceptedMimeType, "unsupported type"),
  blobPathname: z.string().min(1),
});

/**
 * Registers an uploaded file and ingests it synchronously.
 *
 * Synchronous by design, as the briefing requires, which is why the ingestion
 * limits exist: the whole run has to finish inside one invocation.
 */
export async function POST(request: Request) {
  const account = await currentAccount();
  if (!account) {
    return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
  }
  const { userId } = account;

  const verdict = await checkRateLimit(userId, "ingestion", account.isDemo);
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: `Zu viele Uploads. Bitte in ${Math.ceil(verdict.resetSeconds / 60)} Minuten erneut versuchen.` },
      { status: 429, headers: rateLimitHeaders(verdict) },
    );
  }

  const parsed = bodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Ungültige Anfrage." }, { status: 400 });
  }

  const { notebookId, filename, mimeType, blobPathname } = parsed.data;

  if (!(await hasQuota(userId, notebookId))) {
    return NextResponse.json({ error: "Das Kontingent dieses Notebooks ist erschöpft." }, { status: 409 });
  }

  // createSource resolves the notebook through the tenant-scoped reader, so a
  // foreign notebook id yields null here and never a row.
  const source = await createSource(userId, { notebookId, filename, mimeType, blobPathname });
  if (!source) {
    return NextResponse.json({ error: "Notebook nicht gefunden." }, { status: 404 });
  }

  // The blob is read server side from its pathname. Accepting a URL from the
  // client would let a caller point ingestion at any address it likes.
  const result = await ingestSource(userId, source.id);

  return NextResponse.json(
    { sourceId: source.id, ...result },
    { status: result.status === "ready" ? 201 : 422 },
  );
}
