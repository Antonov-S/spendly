import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";

interface ResetPasswordPageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const { token } = await searchParams;

  if (!token) {
    return (
      <AuthCard
        title="Invalid reset link"
        subtitle="This password-reset link is missing or malformed."
        footer={
          <>
            Need a new link?{" "}
            <Link href="/forgot-password" className="font-medium text-success">
              Request one
            </Link>
          </>
        }
      >
        <p className="text-[12px] text-ink-2">
          Open the most recent reset link from your email, or request a fresh
          one to continue.
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Set a new password"
      subtitle="Choose a new password for your Spendly account."
      footer={
        <>
          Remembered it?{" "}
          <Link href="/sign-in" className="font-medium text-success">
            Sign in
          </Link>
        </>
      }
    >
      <ResetPasswordForm token={token} />
    </AuthCard>
  );
}
