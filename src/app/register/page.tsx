import Link from "next/link";
import { redirectIfAuthenticated } from "@/lib/auth/guards";
import { AuthCard } from "@/components/auth/auth-card";
import { RegisterForm } from "@/components/auth/register-form";

export default async function RegisterPage() {
  await redirectIfAuthenticated();

  return (
    <AuthCard
      title="Create your account"
      subtitle="Start tracking with intention"
      footer={
        <>
          Already have an account?{" "}
          <Link href="/sign-in" className="font-medium text-success">
            Sign in
          </Link>
        </>
      }
    >
      <RegisterForm />
    </AuthCard>
  );
}
