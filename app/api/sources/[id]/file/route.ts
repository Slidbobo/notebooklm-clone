import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUserId } from "@/lib/auth/session";
import { createSignedSourceUrl } from "@/lib/blob/signed-url";
import { getSource } from "@/lib/db/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();

/**
 * Hands out a short-lived URL for the original file behind a source.
 *
 * The store is private, so this route is the only way to the bytes. Ownership is
 * checked server side first, and a source owned by somebody else answers 404
 * rather than 403, so a probe cannot confirm that an id exists.
 *
 * The redirect target expires after a minute. That is the difference between a
 * signed URL and a long one, and it is asserted in lib/blob/signed-url.test.ts
 * against the real store rather than assumed.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });

  const { id } = await params;
  const parsed = idSchema.safeParse(id);
  if (!parsed.success) return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });

  const source = await getSource(userId, parsed.data);
  if (!source) return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });

  try {
    const url = await createSignedSourceUrl(source.blobPathname);
    return NextResponse.redirect(url, { status: 307 });
  } catch (error) {
    console.error("[sources] signing failed", error);
    return NextResponse.json({ error: "Datei nicht verfügbar." }, { status: 503 });
  }
}
