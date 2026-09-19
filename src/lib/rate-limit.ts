import "server-only";

/**
 * Rate limiting with a production-safe backend.
 *
 * - If UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN are set,
 *   uses Upstash sliding-window limiting (shared across serverless
 *   instances — the production configuration).
 * - Otherwise degrades to per-instance in-memory limiting and logs a
 *   LOUD warning once. Good enough for local dev; NOT for production
 *   (each serverless instance counts separately).
 * - If Upstash is configured but errors at runtime, requests are
 *   limited by the in-memory fallback rather than being let through
 *   unchecked (degrade-closed, availability preserved).
 */

interface LimiterResult {
  allowed: boolean;
  /** true when running on the non-distributed fallback */
  degraded: boolean;
}

type UpstashLimiter = {
  limit: (id: string) => Promise<{ success: boolean }>;
};

const upstashCache = new Map<string, UpstashLimiter>();
let warnedDegraded = false;
let upstashModulePromise: Promise<{
  Ratelimit: new (cfg: unknown) => UpstashLimiter & Record<string, unknown>;
  Redis: { fromEnv: () => unknown };
} | null> | null = null;

function upstashConfigured(): boolean {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

async function loadUpstash() {
  if (!upstashModulePromise) {
    upstashModulePromise = (async () => {
      try {
        const [{ Ratelimit }, { Redis }] = await Promise.all([
          import("@upstash/ratelimit"),
          import("@upstash/redis"),
        ]);
        return { Ratelimit, Redis } as never;
      } catch (e) {
        console.error("[rate-limit] Upstash packages unavailable:", e);
        return null;
      }
    })();
  }
  return upstashModulePromise;
}

// ---- in-memory fallback (per instance) ----
const memHits = new Map<string, { n: number; reset: number }>();
function memoryLimit(key: string, limit: number, windowSec: number): boolean {
  const now = Date.now();
  const h = memHits.get(key);
  if (!h || h.reset < now) {
    memHits.set(key, { n: 1, reset: now + windowSec * 1000 });
    return true;
  }
  h.n += 1;
  if (memHits.size > 10_000) memHits.clear(); // crude memory cap
  return h.n <= limit;
}

/**
 * checkRateLimit("public-upload:ip", ipHash, 20, 60)
 * Key shape: `${route}:${dimension}` + identifier — giving per-route,
 * per-IP and per-token limits as required.
 */
export async function checkRateLimit(
  bucket: string,
  identifier: string,
  limit: number,
  windowSec: number
): Promise<LimiterResult> {
  const key = `${bucket}:${identifier}`;

  if (upstashConfigured()) {
    const mod = await loadUpstash();
    if (mod) {
      try {
        let limiter = upstashCache.get(bucket);
        if (!limiter) {
          limiter = new mod.Ratelimit({
            redis: mod.Redis.fromEnv(),
            limiter: (mod.Ratelimit as unknown as {
              slidingWindow: (l: number, w: string) => unknown;
            }).slidingWindow(limit, `${windowSec} s`),
            prefix: `taxdesk:${bucket}`,
          }) as UpstashLimiter;
          upstashCache.set(bucket, limiter);
        }
        const { success } = await limiter.limit(identifier);
        return { allowed: success, degraded: false };
      } catch (e) {
        console.error("[rate-limit] Upstash error, using in-memory fallback:", e);
      }
    }
  } else if (!warnedDegraded && process.env.NODE_ENV === "production") {
    warnedDegraded = true;
    console.warn(
      "[rate-limit] WARNING: UPSTASH_REDIS_REST_URL/TOKEN not set. " +
        "Public-route rate limiting is per-instance only — configure Upstash before real launch."
    );
  }

  return { allowed: memoryLimit(key, limit, windowSec), degraded: true };
}
