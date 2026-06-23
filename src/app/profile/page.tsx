export const dynamic = "force-dynamic";

export const metadata = { title: "Profile" };

import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSessionOrRedirect } from "@/lib/auth/guards";
import { getUserOverview, getProfileStats } from "@/lib/db/profile";
import { Avatar } from "@/components/ui/avatar";
import { SubmitButton } from "@/components/auth/submit-button";
import { PlanBadge } from "@/components/settings/plan-badge";
import { ProfileStats } from "@/components/profile/profile-stats";
import { ChangePasswordForm } from "@/components/profile/change-password-form";
import { DeleteAccountDialog } from "@/components/profile/delete-account-dialog";
import { signOutAction } from "@/actions/auth";

export default async function ProfilePage() {
  const session = await getSessionOrRedirect();

  const user = await getUserOverview(session.user.id);

  if (!user) {
    redirect("/sign-in");
  }

  const stats = await getProfileStats(session.user.id);

  const memberSince = user.createdAt.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  // Password change is only meaningful for email/password accounts; OAuth-only
  // users have no password to verify against.
  const hasPassword = user.password !== null;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col gap-6 px-4 py-10">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-[12px] text-ink-2 transition-colors hover:text-ink"
      >
        <ArrowLeft size={14} />
        Back to dashboard
      </Link>

      <div className="rounded-xl border border-line bg-surface p-6">
        <h2 className="text-[13px] font-medium text-ink">Account</h2>
        <div className="mt-4 flex items-center gap-4">
          <Avatar
            name={user.name}
            email={user.email}
            image={user.image}
            className="h-14 w-14"
            textClassName="text-[18px]"
          />
          <div className="min-w-0">
            <h1 className="truncate text-[18px] font-medium text-ink">
              {user.name?.trim() || "Account"}
            </h1>
            <p className="truncate text-[12px] text-ink-2">{user.email}</p>
          </div>
        </div>

        <dl className="mt-6 flex flex-col divide-y divide-line border-t border-line text-[13px]">
          <ProfileRow label="Plan" value={<PlanBadge isPro={user.isPro} />} />
          <ProfileRow label="Preferred currency" value={user.preferredCurrency} />
          <ProfileRow label="Member since" value={memberSince} />
        </dl>
      </div>

      <ProfileStats stats={stats} />

      {hasPassword && <ChangePasswordForm />}

      <DeleteAccountDialog email={user.email} />

      <form action={signOutAction}>
        <SubmitButton className="bg-surface text-ink hover:bg-surface-2">
          Sign out
        </SubmitButton>
      </form>
    </div>
  );
}

function ProfileRow({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between py-3">
      <dt className="text-ink-2">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}
