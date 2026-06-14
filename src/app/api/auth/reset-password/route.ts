import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { consumePasswordResetToken } from "@/lib/auth/password-reset";
import { resetPasswordSchema } from "@/lib/validations/auth";
import { BCRYPT_SALT_ROUNDS } from "@/lib/system-constants";
import {
  checkRateLimit,
  getClientIp,
  tooManyRequestsResponse,
} from "@/lib/rate-limit";

/**
 * POST /api/auth/reset-password { token, password, confirmPassword }
 * Consume the reset token, hash the new password, and store it. Clicking an
 * emailed link proves ownership, so a reset also marks the email verified when
 * it wasn't already.
 */
export async function POST(request: Request) {
  const { success, retryAfterSeconds } = await checkRateLimit(
    "resetPassword",
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

  const parsed = resetPasswordSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const { token, password } = parsed.data;

  const email = await consumePasswordResetToken(token);
  if (!email) {
    return NextResponse.json(
      { error: "This reset link is invalid or has expired." },
      { status: 400 }
    );
  }

  const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);

  await prisma.user.update({
    where: { email },
    data: {
      password: hashedPassword,
      // A clicked reset link proves ownership — double it as verification.
      emailVerified: new Date(),
    },
  });

  return NextResponse.json({ success: true });
}
