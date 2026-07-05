import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/auth/reset-password/route";
import { prisma } from "@/lib/prisma";
import { consumePasswordResetToken } from "@/lib/auth/password-reset";
import { checkRateLimit } from "@/lib/rate-limit";
import bcrypt from "bcryptjs";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth/password-reset", () => ({
  consumePasswordResetToken: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientIp: vi.fn(() => "127.0.0.1"),
  tooManyRequestsResponse: vi.fn(() => new Response("Too many", { status: 429 })),
}));

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn(),
  },
}));

const update = vi.mocked(prisma.user.update);
const consumeToken = vi.mocked(consumePasswordResetToken);
const rateLimit = vi.mocked(checkRateLimit);
const hash = vi.mocked(bcrypt.hash);

function request(body: unknown) {
  return new Request("https://spendly.test/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

describe("POST /api/auth/reset-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rateLimit.mockResolvedValue({
      success: true,
      retryAfterSeconds: 0,
      remaining: 1,
      limit: 5,
      reset: Date.now(),
    });
  });

  it("stores the new password and bumps the session epoch", async () => {
    consumeToken.mockResolvedValue("user@example.com");
    hash.mockResolvedValue("hashed-new" as never);
    update.mockResolvedValue({} as never);

    const response = await POST(
      request({
        token: "reset-token",
        password: "new-password-123",
        confirmPassword: "new-password-123",
      })
    );

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith({
      where: { email: "user@example.com" },
      data: {
        password: "hashed-new",
        sessionEpoch: { increment: 1 },
        emailVerified: expect.any(Date),
      },
    });
  });

  it("does not update the user when the reset token is invalid", async () => {
    consumeToken.mockResolvedValue(null);

    const response = await POST(
      request({
        token: "bad-token",
        password: "new-password-123",
        confirmPassword: "new-password-123",
      })
    );

    expect(response.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });
});
