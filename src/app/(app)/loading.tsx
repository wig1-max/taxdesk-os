/**
 * App-wide navigation fallback. Shows instantly on every route change
 * inside the authenticated shell (the sidebar persists), so clicks feel
 * responsive even while the server component fetches data.
 */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-7 w-56 rounded bg-muted" />
      <div className="h-4 w-80 rounded bg-muted/70" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="h-40 rounded-lg bg-muted/50" />
        <div className="h-40 rounded-lg bg-muted/50" />
        <div className="h-40 rounded-lg bg-muted/50" />
      </div>
    </div>
  );
}
