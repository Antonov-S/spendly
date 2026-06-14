import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createPasswordResetToken } from "@/lib/auth/password-reset";
import { sendPasswordResetEmail } from "@/lib/email/send-password-reset-email";
import { forgotPasswordSchema } from "@/lib/validations/auth";
import {
  checkRateLimit,
  getClientIp,
  tooManyRequestsResponse,
} from "@/lib/rate-limit";

/**
 * POST /api/auth/forgot-password { email }
 * Issue and send a password-reset link. Always responds with a generic success
 * to avoid leaking which emails are registered; an email is only sent when a
 * credentials account (one with a password) actually exists. A Resend failure
 * is logged but never changes the response.
 */
export async function POST(request: Request) {
  const { success, retryAfterSeconds } = await checkRateLimit(
    "forgotPassword",
    getClientIp(request.headers)
  );
  if (!success) {
    return tooManyRequestsResponse(retryAfterSeconds);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = forgotPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  const { email } = parsed.data;

  const user = await prisma.user.findUnique({ where: { email } });

  // Only credentials accounts (those with a password) can reset. OAuth-only
  // users have nothing to reset; the generic response hides the difference.
  if (user?.password) {
    try {
      const token = await createPasswordResetToken(email);
      await sendPasswordResetEmail(email, token);
    } catch (error) {
      console.error("Failed to send password-reset email", error);
    }
  }

  return NextResponse.json({ success: true });
}
