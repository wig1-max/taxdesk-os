"use client";

import { useFormStatus } from "react-dom";
import { cn } from "@/lib/utils";

/**
 * Submit button that shows a pending state while its enclosing server-
 * action <form> is running. Must be rendered INSIDE the <form>. Gives
 * immediate feedback on slow actions (PDF render, guarded transitions)
 * that redirect only after completing.
 */
export function SubmitButton({
  children,
  pendingText = "Working…",
  className,
}: {
  children: React.ReactNode;
  pendingText?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={cn(className, pending && "opacity-70")}>
      {pending ? pendingText : children}
    </button>
  );
}
