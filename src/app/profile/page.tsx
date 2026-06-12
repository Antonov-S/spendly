export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getSessionOrRedirect } from "@/lib/auth/guards";
import { Avatar } from "@/components/ui/avatar";
import { SubmitButton } from "@/components/auth/submit-button";
import { signOutAction } from "@/actions/auth";

export default async function ProfilePage() {
  const session = await getSessionOrRedirect();

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      name: true,
      email: true,
      image: true,
      isPro: true,
      preferredCurrency: true,
      createdAt: true,
    },
  });

  if (!user) {
    redirect("/sign-in");
  }

  const memberSince = user.createdAt.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col gap-6 px-4 py-10">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-[12px] text-ink-2 transition-colors hover:text-ink"
      >
        <ArrowLeft size={14} />
        Back to dashboard
      </Link>

      <div className="rounded-xl border border-line bg-surface p-6">
        <div className="flex items-center gap-4">
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
          <ProfileRow label="Plan" value={user.isPro ? "Pro" : "Free"} />
          <ProfileRow label="Preferred currency" value={user.preferredCurrency} />
          <ProfileRow label="Member since" value={memberSince} />
        </dl>
      </div>

      <form action={signOutAction}>
        <SubmitButton className="bg-surface text-ink hover:bg-surface-2">
          Sign out
        </SubmitButton>
      </form>
    </div>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-3">
      <dt className="text-ink-2">{label}</dt>
      <dd className="font-medium text-ink">{value}</dd>
    </div>
  );
}
