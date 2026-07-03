import { describe, it, expect, vi, afterEach } from "vitest";

// One shared mock for the Upstash limiter's `.limit()` method. Hoisted so the
// vi.mock factory below can reference it.
const { limitMock } = vi.hoisted(() => ({ limitMock: vi.fn() }));

vi.mock("@upstash/redis", () => ({
  Redis: class {},
}));

vi.mock("@upstash/ratelimit", () => {
  class Ratelimit {
    limit = limitMock;
    static slidingWindow = vi.fn(() => "sliding-window");
  }
  return { Ratelimit };
});

// The module lazily reads env on first use and caches the limiters, so each
// scenario re-imports a fresh copy with the env it needs.
async function loadWithRedis() {
  vi.resetModules();
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://example.upstash.io");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");
  return import("@/lib/rate-limit");
}

async function loadWithoutRedis() {
  vi.resetModules();
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
  return import("@/lib/rate-limit");
}

afterEach(() => {
  vi.unstubAllEnvs();
  limitMock.mockReset();
});

describe("checkRateLimit", () => {
  it("fails open and never calls Upstash when Redis is not configured", async () => {
    const { checkRateLimit } = await loadWithoutRedis();

    const result = await checkRateLimit("login", "1.2.3.4:user@example.com");

    expect(result.success).toBe(true);
    expect(result.retryAfterSeconds).toBe(0);
    expect(limitMock).not.toHaveBeenCalled();
  });

  it("passes through a successful limit result", async () => {
    const { checkRateLimit } = await loadWithRedis();
    limitMock.mockResolvedValue({
      success: true,
      remaining: 4,
      reset: Date.now() + 1000,
    });

    const result = await checkRateLimit("register", "1.2.3.4");

    expect(result.success).toBe(true);
    expect(result.remaining).toBe(4);
    expect(limitMock).toHaveBeenCalledWith("1.2.3.4");
  });

  it("reports failure with a positive retryAfterSeconds when exhausted", async () => {
    const { checkRateLimit } = await loadWithRedis();
    limitMock.mockResolvedValue({
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
    });

    const result = await checkRateLimit("login", "1.2.3.4:user@example.com");

    expect(result.success).toBe(false);
    expect(result.retryAfterSeconds).toBeGreaterThan(58);
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("fails open when the Upstash request throws", async () => {
    const { checkRateLimit } = await loadWithRedis();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    limitMock.mockRejectedValue(new Error("upstash down"));

    const result = await checkRateLimit("resetPassword", "1.2.3.4");

    expect(result.success).toBe(true);
    expect(result.retryAfterSeconds).toBe(0);
    spy.mockRestore();
  });
});

describe("getClientIp", () => {
  it("prefers x-real-ip even when x-forwarded-for holds a spoofed value", async () => {
    const { getClientIp } = await loadWithoutRedis();
    const headers = new Headers({
      "x-real-ip": "203.0.113.7",
      "x-forwarded-for": "6.6.6.6, 203.0.113.7",
    });

    expect(getClientIp(headers)).toBe("203.0.113.7");
  });

  it("uses x-real-ip when it is the only header present", async () => {
    const { getClientIp } = await loadWithoutRedis();
    const headers = new Headers({ "x-real-ip": "9.8.7.6" });

    expect(getClientIp(headers)).toBe("9.8.7.6");
  });

  it("returns a single-entry x-forwarded-for verbatim", async () => {
    const { getClientIp } = await loadWithoutRedis();
    const headers = new Headers({ "x-forwarded-for": "1.1.1.1" });

    expect(getClientIp(headers)).toBe("1.1.1.1");
  });

  it("takes the LAST x-forwarded-for entry — the platform hop, not a spoofed prefix", async () => {
    const { getClientIp } = await loadWithoutRedis();
    const headers = new Headers({
      "x-forwarded-for": "9.9.9.9, 8.8.8.8, 203.0.113.7",
    });

    expect(getClientIp(headers)).toBe("203.0.113.7");
  });

  it("trims whitespace around entries", async () => {
    const { getClientIp } = await loadWithoutRedis();
    const headers = new Headers({
      "x-forwarded-for": "9.9.9.9 ,  203.0.113.7  ",
    });

    expect(getClientIp(headers)).toBe("203.0.113.7");
  });

  it("returns 'unknown' when no proxy headers are present", async () => {
    const { getClientIp } = await loadWithoutRedis();

    expect(getClientIp(new Headers())).toBe("unknown");
  });
});

describe("tooManyRequestsResponse", () => {
  it("returns 429 with a Retry-After header and a pluralized message", async () => {
    const { tooManyRequestsResponse } = await loadWithoutRedis();

    const res = tooManyRequestsResponse(90);
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("90");
    expect(body.error).toBe("Too many attempts. Please try again in 2 minutes.");
  });

  it("uses the singular 'minute' and a floor of 1 for short windows", async () => {
    const { tooManyRequestsResponse } = await loadWithoutRedis();

    const res = tooManyRequestsResponse(30);
    const body = (await res.json()) as { error: string };

    expect(body.error).toBe("Too many attempts. Please try again in 1 minute.");
  });
});
