/**
 * Hard bounds on ingestion.
 *
 * The flow is synchronous by design, so it has to finish inside one function
 * invocation and inside the provider's rate limits. A 10 MB PDF can hold several
 * hundred pages, which would be thousands of chunks and thousands of embedding
 * requests: that exceeds the platform timeout and the free-tier quota long
 * before it exceeds anything else. Rather than fail halfway and leave a source
 * in a broken state, extraction stops at a documented ceiling and says so.
 */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/** Roughly 60 pages of dense text. Beyond this the source is rejected. */
export const MAX_EXTRACTED_CHARS = 200_000;

/** Sources per notebook, so a shared demo account cannot fill the store. */
export const MAX_SOURCES_PER_NOTEBOOK = 12;

export const ACCEPTED_MIME_TYPES = ["application/pdf", "text/plain"] as const;

export type AcceptedMimeType = (typeof ACCEPTED_MIME_TYPES)[number];

export function isAcceptedMimeType(value: string): value is AcceptedMimeType {
  return (ACCEPTED_MIME_TYPES as readonly string[]).includes(value);
}
