import { StatusPill } from "@/components/ui/status";

/**
 * Back-compat status badge. Existing callers pass a raw status `code`
 * (optionally a display `label`); tone + humanized label now come from the
 * shared resolver (K.2.8.5) so every status is coloured consistently.
 */
export function StatusBadge({ code, label }: { code: string; label?: string }) {
  return <StatusPill code={code} label={label} />;
}
