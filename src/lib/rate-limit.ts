import "server-only";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";
import { RATE_LIMITS, type RateLimitName } from "@/lib/system-constants";

export interface RateLimitResult {
  /** False when the caller has exhausted its budget for the window. */
  success: boolean;
  /** Requests left in the current window. */
  remaining: number;
  /** Epoch ms at which the window resets. */
  reset: number;
  /** Whole seconds until the window resets (>= 0). Used for `Retry-After`. */
  retryAfterSeconds: number;
}

/** Returned when limiting is skipped (no Redis configured) or fails open. */
const ALLOW: RateLimitResult = {
  success: true,
  remaining: Number.POSITIVE_INFINITY,
  reset: 0,
  retryAfterSeconds: 0,
};

// Built lazily on first use. When the Upstash env vars are absent (e.g. local
// dev without Redis) we never construct a client and every check fails open.
let limiters: Record<RateLimitName, Ratelimit> | null = null;
let initialized = false;

function getLimiters(): Record<RateLimitName, Ratelimit> | null {
  if (initialized) return limiters;
  initialized = true;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    return null;
  }

  const redis = new Redis({ url, token });
  limiters = Object.fromEntries(
    Object.entries(RATE_LIMITS).map(([name, cfg]) => [
      name,
      new Ratelimit({
        redis,
        limiter: Ratelimit.slidingWindow(cfg.limit, cfg.window),
        prefix: `ratelimit:${name}`,
        analytics: false,
      }),
    ])
  ) as Record<RateLimitName, Ratelimit>;
  return limiters;
}

/**
 * Consume one token from the named limiter for `identifier`. Fails open
 * (returns success) when Redis isn't configured or the request to Upstash
 * errors — auth must never become unusable because the limiter is down.
 */
export async function checkRateLimit(
  name: RateLimitName,
  identifier: string
): Promise<RateLimitResult> {
  const all = getLimiters();
  if (!all) return ALLOW;

  try {
    const { success, remaining, reset } = await all[name].limit(identifier);
    const retryAfterSeconds = Math.max(0, Math.ceil((reset - Date.now()) / 1000));
    return { success, remaining, reset, retryAfterSeconds };
  } catch (error) {
    console.error(`Rate limit check failed for "${name}"`, error);
    return ALLOW;
  }
}

/**
 * Best-effort client IP from proxy headers. Vercel sets `x-forwarded-for`;
 * the first entry is the originating client. Falls back to `x-real-ip` and
 * finally a constant so a missing header still produces a stable bucket.
 */
export function getClientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return headers.get("x-real-ip")?.trim() || "unknown";
}

/**
 * Standard 429 response for the plain API route handlers (register,
 * forgot/reset password, resend verification, export). Includes a `Retry-After`
 * header, a user-facing minutes message, and a stable `code` so the export
 * routes' unified failure contract (`{ error, code }`, data-export-spec §7.1.1)
 * is one shape across 401/429/413.
 */
export function tooManyRequestsResponse(retryAfterSeconds: number): NextResponse {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return NextResponse.json(
    {
      error: `Too many attempts. Please try again in ${minutes} minute${
        minutes === 1 ? "" : "s"
      }.`,
      code: "rate_limited",
    },
    { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } }
  );
}
