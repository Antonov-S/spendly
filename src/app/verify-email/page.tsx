import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { ResendVerification } from "@/components/auth/resend-verification";

export const metadata = { title: "Verify email" };

interface VerifyEmailPageProps {
  searchParams: Promise<{ email?: string; error?: string }>;
}

export default async function VerifyEmailPage({
  searchParams,
}: VerifyEmailPageProps) {
  const { email, error } = await searchParams;

  return (
    <AuthCard
      title="Check your inbox"
      subtitle="We sent you a link to verify your email address."
      footer={
        <>
          Already verified?{" "}
          <Link href="/sign-in" className="font-medium text-success">
            Sign in
          </Link>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {error === "invalid" && (
          <p className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[12px] text-danger">
            That verification link is invalid or has expired. Request a new one
            below.
          </p>
        )}

        <p className="text-[12px] text-ink-2">
          Click the link in the email to activate your account. Didn&apos;t get
          it? Enter your email to send a fresh link.
        </p>

        <ResendVerification initialEmail={email} />
      </div>
    </AuthCard>
  );
}
