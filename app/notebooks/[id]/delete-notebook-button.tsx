"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { deleteNotebookAction } from "../actions";

/**
 * Two-step delete.
 *
 * Deleting a notebook takes its sources, chunks and chat history with it through
 * the foreign keys, and the demo notebooks are what a reviewer is looking at. A
 * single click on a button labelled "löschen" is one stray click away from an
 * empty demo. The confirmation resets itself after a few seconds, so an
 * abandoned click does not leave a live delete button sitting on the page.
 *
 * Deliberately not window.confirm: a native dialog blocks the page and would
 * stop the scripted walkthrough dead.
 */
const RESET_AFTER_MS = 5_000;

export function DeleteNotebookButton({ notebookId }: { notebookId: string }) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), RESET_AFTER_MS);
    return () => clearTimeout(timer);
  }, [armed]);

  if (!armed) {
    return (
      <Button variant="outline" size="sm" type="button" onClick={() => setArmed(true)}>
        Notebook löschen
      </Button>
    );
  }

  return (
    <form action={deleteNotebookAction} className="flex items-center gap-2">
      <input type="hidden" name="id" value={notebookId} />
      <span className="text-sm text-muted-foreground">Wirklich löschen?</span>
      <Button variant="destructive" size="sm" type="submit">
        Ja, löschen
      </Button>
      <Button variant="outline" size="sm" type="button" onClick={() => setArmed(false)}>
        Abbrechen
      </Button>
    </form>
  );
}
