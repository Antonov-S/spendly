import "server-only";
import { resend } from "@/lib/email/resend";
import { EMAIL_FROM } from "@/lib/system-constants";

/** Base URL for reset links; falls back to local dev. */
function baseUrl(): string {
  return process.env.AUTH_URL ?? "http://localhost:3000";
}

function passwordResetHtml(link: string): string {
  return `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a1a;">
      <h1 style="font-size: 20px; font-weight: 500;">Reset your password</h1>
      <p style="font-size: 14px; line-height: 1.5; color: #444;">
        We received a request to reset the password for your Spendly account.
        Click the button below to choose a new one.
      </p>
      <p style="margin: 24px 0;">
        <a href="${link}"
           style="display: inline-block; background: #1D9E75; color: #fff;
                  text-decoration: none; padding: 10px 20px; border-radius: 8px;
                  font-size: 14px; font-weight: 500;">
          Reset password
        </a>
      </p>
      <p style="font-size: 12px; line-height: 1.5; color: #888;">
        Or paste this link into your browser:<br />
        <a href="${link}" style="color: #1D9E75;">${link}</a>
      </p>
      <p style="font-size: 12px; color: #888;">
        This link expires in 1 hour. If you didn't request a password reset,
        you can safely ignore this email — your password won't change.
      </p>
    </div>
  `;
}

/**
 * Send a password-reset email containing a single-use link built from the raw
 * token. The link points at the reset-password page.
 */
export async function sendPasswordResetEmail(
  email: string,
  token: string
): Promise<void> {
  const link = `${baseUrl()}/reset-password?token=${token}`;

  await resend.emails.send({
    from: EMAIL_FROM,
    to: email,
    subject: "Reset your Spendly password",
    html: passwordResetHtml(link),
  });
}
