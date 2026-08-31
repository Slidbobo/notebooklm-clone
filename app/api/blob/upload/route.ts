import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUserId } from "@/lib/auth/session";
import { getNotebook } from "@/lib/db/access";
import { ACCEPTED_MIME_TYPES, MAX_UPLOAD_BYTES } from "@/lib/ingestion/limits";
import { hasQuota } from "@/lib/ingestion/ingest";

export const runtime = "nodejs";

const payloadSchema = z.object({ notebookId: z.string().uuid() });

/**
 * Issues a short-lived upload token for a direct browser-to-Blob upload.
 *
 * Files go straight from the browser to Blob storage rather than through a route
 * handler, because Vercel caps a function's request body at 4.5 MB and the limit
 * for a source is 10 MB. That turns out to be the safer arrangement anyway: the
 * ownership check moves into token issuance, so the server decides whether this
 * account may write into this notebook before a single byte is accepted, and the
 * token itself constrains content type and size.
 *
 * Everything here is server side. The client never sees the blob token, only a
 * signed grant for one specific upload.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        const userId = await currentUserId();
        if (!userId) throw new Error("unauthenticated");

        const parsed = payloadSchema.safeParse(JSON.parse(clientPayload ?? "{}"));
        if (!parsed.success) throw new Error("invalid payload");

        // A notebook belonging to somebody else reads as missing, so a failed
        // upload cannot be used to discover that a notebook id exists.
        const notebook = await getNotebook(userId, parsed.data.notebookId);
        if (!notebook) throw new Error("not found");

        if (!(await hasQuota(userId, notebook.id))) throw new Error("quota exceeded");

        return {
          allowedContentTypes: [...ACCEPTED_MIME_TYPES],
          maximumSizeInBytes: MAX_UPLOAD_BYTES,
          // Namespaced by owner so a listing of the store cannot mix tenants.
          addRandomSuffix: true,
          pathname: `sources/${userId}/${notebook.id}`,
          tokenPayload: JSON.stringify({ notebookId: notebook.id }),
        };
      },
      // Ingestion is triggered by the client once the upload finishes. The
      // completion callback needs a publicly reachable URL and therefore never
      // fires during local development, which would make the flow untestable
      // on a laptop.
      onUploadCompleted: async () => {},
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("[blob] upload token refused", error);
    // One status for every refusal: unauthenticated, foreign notebook, and
    // exhausted quota are indistinguishable from outside.
    return NextResponse.json({ error: "Upload nicht möglich." }, { status: 400 });
  }
}
