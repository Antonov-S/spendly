export const dynamic = "force-dynamic";

import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getSessionOrRedirect } from "@/lib/auth/guards";
import { getUserOverview } from "@/lib/db/profile";
import { reconcileCheckoutReturn } from "@/lib/db/billing";
import { getAccountLabels } from "@/lib/db/accounts";
import { PlanBadge } from "@/components/settings/plan-badge";
import { SettingsNameForm } from "@/components/settings/settings-name-form";
import {
  BillingActions,
  type CheckoutResult,
} from "@/components/settings/billing-actions";
import { ExportLinks } from "@/components/accounts/export-links";

interface SettingsPageProps {
  searchParams: Promise<{
    account?: string;
    checkout?: string;
    session_id?: string;
  }>;
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const session = await getSessionOrRedirect();
  const sp = await searchParams;

  // Return-side reconciliation (§5/§12.7): if the browser redirect from Checkout
  // beat the webhook, close the gap before first paint. Idempotent + swallows
  // errors, so a successful payment never renders as an error.
  if (sp.checkout === "success") {
    await reconcileCheckoutReturn(session.user.id, sp.session_id);
  }

  // Settings is an escape hatch like /profile — reachable for a zero-account
  // user, so it is NOT behind requireOnboarded().
  const user = await getUserOverview(session.user.id);
  if (!user) {
    redirect("/sign-in");
  }

  const checkoutResult: CheckoutResult =
    sp.checkout === "success"
      ? "success"
      : sp.checkout === "cancelled"
        ? "cancelled"
        : undefined;

  // Resolve the active export scope from `?account=` against the user's own
  // accounts (active + archived). An unresolvable id is normalized away so the
  // label and the actual download never disagree (avoids a silently-empty file).
  const requestedAccountId = sp.account || undefined;
  const accounts = await getAccountLabels(session.user.id);
  const scoped = requestedAccountId
    ? accounts.find((a) => a.id === requestedAccountId)
    : undefined;
  const exportAccountId = scoped?.id;
  const scopeLabel = scoped
    ? `${scoped.name}${scoped.isArchived ? " (archived)" : ""}`
    : "All accounts";

  const planSummary = user.isPro
    ? user.stripeSubscriptionId
      ? "Pro · subscription active."
      : "You're on Pro."
    : "You're on the Free plan.";

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-lg flex-col gap-6 px-4 py-10">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1.5 text-[12px] text-ink-2 transition-colors hover:text-ink"
      >
        <ArrowLeft size={14} />
        Back to dashboard
      </Link>

      {/* Preferences */}
      <section
        aria-labelledby="preferences-heading"
        className="rounded-xl border border-line bg-surface p-6"
      >
        <h1 id="preferences-heading" className="text-[13px] font-medium text-ink">
          Preferences
        </h1>
        <p className="mt-1 text-[12px] text-ink-2">
          Update how your name appears across Spendly.
        </p>
        <SettingsNameForm name={user.name} email={user.email} />
      </section>

      {/* Billing */}
      <section
        aria-labelledby="billing-heading"
        className="rounded-xl border border-line bg-surface p-6"
      >
        <div className="flex items-center justify-between">
          <h2 id="billing-heading" className="text-[13px] font-medium text-ink">
            Billing
          </h2>
          <PlanBadge isPro={user.isPro} />
        </div>
        <p className="mt-2 text-[12px] text-ink-2">{planSummary}</p>
        <BillingActions
          isPro={user.isPro}
          hasCustomer={!!user.stripeCustomerId}
          checkoutResult={checkoutResult}
        />
      </section>

      {/* Your data */}
      <section
        aria-labelledby="your-data-heading"
        className="rounded-xl border border-line bg-surface p-6"
      >
        <h2 id="your-data-heading" className="text-[13px] font-medium text-ink">
          Your data
        </h2>
        <p className="mt-1 text-[12px] text-ink-2">
          Download a copy of your data. Exporting:{" "}
          <span className="font-medium text-ink">{scopeLabel}</span>
        </p>
        <div className="mt-4">
          <ExportLinks accountId={exportAccountId} />
        </div>
      </section>
    </div>
  );
}
