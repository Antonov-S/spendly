import Link from "next/link";
import { redirectIfAuthenticated } from "@/lib/auth/guards";
import { AuthCard } from "@/components/auth/auth-card";
import { SignInForm } from "@/components/auth/sign-in-form";
import { EMAIL_VERIFICATION_ENABLED } from "@/lib/system-constants";

export const metadata = { title: "Sign in" };

interface SignInPageProps {
  searchParams: Promise<{
    registered?: string;
    verified?: string;
    deleted?: string;
    passwordChanged?: string;
    error?: string;
  }>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  await redirectIfAuthenticated();

  const { registered, verified, deleted, passwordChanged, error } =
    await searchParams;

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Sign in to your Spendly account"
      footer={
        <>
          Don&apos;t have an account?{" "}
          <Link href="/register" className="font-medium text-success">
            Create one
          </Link>
        </>
      }
    >
      <SignInForm
        justRegistered={registered === "1"}
        justVerified={verified === "1"}
        justDeleted={deleted === "1"}
        justChangedPassword={passwordChanged === "1"}
        emailVerificationEnabled={EMAIL_VERIFICATION_ENABLED}
        oauthError={
          error === "OAuthAccountNotLinked" ? "OAuthAccountNotLinked" : undefined
        }
      />
    </AuthCard>
  );
}
