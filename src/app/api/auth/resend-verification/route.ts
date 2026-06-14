import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createVerificationToken } from "@/lib/auth/verification";
import { sendVerificationEmail } from "@/lib/email/send-verification-email";
import { EMAIL_VERIFICATION_ENABLED } from "@/lib/system-constants";

const resendSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
});

/**
 * POST /api/auth/resend-verification { email }
 * Re-issue and re-send a verification link. Always responds with a generic
 * success to avoid leaking which emails are registered; an email is only sent
 * when an unverified credentials account actually exists.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = resendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  const { email } = parsed.data;

  // No new tokens are issued when verification enforcement is disabled.
  if (EMAIL_VERIFICATION_ENABLED) {
    const user = await prisma.user.findUnique({ where: { email } });

    if (user && !user.emailVerified) {
      const token = await createVerificationToken(email);
      await sendVerificationEmail(email, token);
    }
  }

  return NextResponse.json({ success: true });
}
