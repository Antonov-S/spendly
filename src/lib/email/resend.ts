import "server-only";
import { Resend } from "resend";

const apiKey = process.env.RESEND_API_KEY;

if (!apiKey) {
  throw new Error("RESEND_API_KEY is not set");
}

/** Shared Resend client. Reused across requests in dev via the global cache. */
const globalForResend = globalThis as unknown as {
  resend: Resend | undefined;
};

export const resend = globalForResend.resend ?? new Resend(apiKey);

if (process.env.NODE_ENV !== "production") {
  globalForResend.resend = resend;
}
