"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { currentUserId } from "@/lib/auth/session";
import { createNotebook, deleteNotebook, renameNotebook } from "@/lib/db/access";

const titleSchema = z.string().trim().min(1, "Titel darf nicht leer sein").max(120);
const idSchema = z.string().uuid();

export type ActionState = { error?: string };

/**
 * Server actions for notebook management.
 *
 * Each one resolves the session itself. There is no path where a notebook id
 * from the form is trusted: it is passed to an access-layer function that only
 * matches rows owned by the resolved user, so a forged id changes nothing.
 */
export async function createNotebookAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await currentUserId();
  if (!userId) return { error: "Nicht angemeldet." };

  const title = titleSchema.safeParse(formData.get("title"));
  if (!title.success) return { error: title.error.issues[0]?.message ?? "Ungültiger Titel." };

  const notebook = await createNotebook(userId, title.data);
  if (!notebook) return { error: "Notebook konnte nicht angelegt werden." };

  revalidatePath("/");
  redirect(`/notebooks/${notebook.id}`);
}

export async function renameNotebookAction(
  _state: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const userId = await currentUserId();
  if (!userId) return { error: "Nicht angemeldet." };

  const id = idSchema.safeParse(formData.get("id"));
  const title = titleSchema.safeParse(formData.get("title"));
  if (!id.success || !title.success) return { error: "Ungültige Eingabe." };

  const updated = await renameNotebook(userId, id.data, title.data);
  if (!updated) return { error: "Notebook nicht gefunden." };

  revalidatePath("/");
  revalidatePath(`/notebooks/${id.data}`);
  return {};
}

export async function deleteNotebookAction(formData: FormData): Promise<void> {
  const userId = await currentUserId();
  if (!userId) return;

  const id = idSchema.safeParse(formData.get("id"));
  if (!id.success) return;

  await deleteNotebook(userId, id.data);
  revalidatePath("/");
  redirect("/");
}
