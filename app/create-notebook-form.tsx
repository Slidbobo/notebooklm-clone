"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { createNotebookAction, type ActionState } from "./notebooks/actions";

export function CreateNotebookForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(createNotebookAction, {});

  return (
    <form action={action} className="space-y-2">
      <div className="flex gap-2">
        <Input name="title" placeholder="Titel des Notebooks" required maxLength={120} />
        <Button type="submit" disabled={pending}>
          {pending ? "Wird angelegt" : "Anlegen"}
        </Button>
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
