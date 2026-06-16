"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

/**
 * App-wide toast surface. Themed to the dark design system; the snackbar undo
 * after a transaction delete uses `toast(..., { action })` against this.
 */
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="dark"
      position="bottom-center"
      toastOptions={{
        classNames: {
          toast:
            "group toast !bg-surface !text-ink !border-line !rounded-lg !shadow-lg",
          description: "!text-ink-3",
          actionButton: "!bg-success !text-white",
          cancelButton: "!bg-surface-2 !text-ink-2",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
