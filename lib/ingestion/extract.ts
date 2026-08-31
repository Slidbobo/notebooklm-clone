import { extractText, getDocumentProxy } from "unpdf";
import { MAX_EXTRACTED_CHARS, type AcceptedMimeType } from "@/lib/ingestion/limits";

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}

/**
 * Turns an uploaded file into plain text.
 *
 * The text produced here is what the citation jump displays and what every
 * chunk's character offsets refer to, so it must stay byte-stable: no
 * reformatting, no trimming beyond the normalisation below, or the offsets stop
 * pointing where they claim to.
 */
export async function extractDocumentText(
  bytes: ArrayBuffer,
  mimeType: AcceptedMimeType,
): Promise<string> {
  const raw = mimeType === "application/pdf" ? await extractPdf(bytes) : decodeText(bytes);
  const normalised = normalise(raw);

  if (normalised.trim().length === 0) {
    throw new ExtractionError(
      "Die Datei enthält keinen extrahierbaren Text. Gescannte PDFs ohne Texterkennung werden nicht unterstützt.",
    );
  }

  if (normalised.length > MAX_EXTRACTED_CHARS) {
    throw new ExtractionError(
      `Die Datei ist zu umfangreich. Es werden bis zu ${MAX_EXTRACTED_CHARS.toLocaleString("de-DE")} Zeichen verarbeitet, diese Datei enthält ${normalised.length.toLocaleString("de-DE")}.`,
    );
  }

  return normalised;
}

async function extractPdf(bytes: ArrayBuffer): Promise<string> {
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    // mergePages narrows the return type to a single string.
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  } catch (error) {
    console.error("[ingestion] pdf extraction failed", error);
    throw new ExtractionError("Das PDF konnte nicht gelesen werden. Möglicherweise ist es beschädigt oder verschlüsselt.");
  }
}

/**
 * TXT is decoded as UTF-8 with a strict decoder. Anything else is rejected
 * rather than silently mangled: a wrongly decoded document produces chunks that
 * look fine, embed badly and cite nonsense, which is worse than a clear refusal.
 */
function decodeText(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ExtractionError(
      "Die Textdatei ist nicht UTF-8 kodiert. Bitte als UTF-8 speichern und erneut hochladen.",
    );
  }
}

/** Normalises line endings and strips the BOM. Nothing else, offsets depend on it. */
function normalise(text: string): string {
  return text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}
