import "server-only";
import { resend } from "@/lib/email/resend";
import { EMAIL_FROM } from "@/lib/system-constants";

/** Base URL for verification links; falls back to local dev. */
function baseUrl(): string {
  return process.env.AUTH_URL ?? "http://localhost:3000";
}

function verificationHtml(link: string): string {
  return `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a1a;">
      <h1 style="font-size: 20px; font-weight: 500;">Verify your email</h1>
      <p style="font-size: 14px; line-height: 1.5; color: #444;">
        Thanks for signing up for Spendly. Confirm your email address to activate
        your account.
      </p>
      <p style="margin: 24px 0;">
        <a href="${link}"
           style="display: inline-block; background: #1D9E75; color: #fff;
                  text-decoration: none; padding: 10px 20px; border-radius: 8px;
                  font-size: 14px; font-weight: 500;">
          Verify email
        </a>
      </p>
      <p style="font-size: 12px; line-height: 1.5; color: #888;">
        Or paste this link into your browser:<br />
        <a href="${link}" style="color: #1D9E75;">${link}</a>
      </p>
      <p style="font-size: 12px; color: #888;">
        This link expires in 24 hours. If you didn't create a Spendly account,
        you can ignore this email.
      </p>
    </div>
  `;
}

/**
 * Send a verification email containing a single-use link built from the raw
 * token. The link points at the GET verification endpoint.
 */
export async function sendVerificationEmail(
  email: string,
  token: string
): Promise<void> {
  const link = `${baseUrl()}/api/auth/verify-email?token=${token}`;

  await resend.emails.send({
    from: EMAIL_FROM,
    to: email,
    subject: "Verify your Spendly email",
    html: verificationHtml(link),
  });
}
