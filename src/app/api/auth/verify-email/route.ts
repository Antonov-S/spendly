import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { consumeVerificationToken } from "@/lib/auth/verification";

/**
 * GET /api/auth/verify-email?token=<raw>
 * Consume the token, mark the user verified, and redirect to sign-in.
 * Invalid or expired tokens send the user back to the verify-email screen so
 * they can request a fresh link.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");

  if (!token) {
    return NextResponse.redirect(new URL("/verify-email?error=invalid", request.url));
  }

  const email = await consumeVerificationToken(token);
  if (!email) {
    return NextResponse.redirect(new URL("/verify-email?error=invalid", request.url));
  }

  await prisma.user.update({
    where: { email },
    data: { emailVerified: new Date() },
  });

  return NextResponse.redirect(new URL("/sign-in?verified=1", request.url));
}
