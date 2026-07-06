export const dynamic = "force-dynamic";

export const metadata = { title: "Settings" };

import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Upload } from "lucide-react";
import { getSessionOrRedirect } from "@/lib/auth/guards";
import { getUserOverview } from "@/lib/db/profile";
import { reconcileCheckoutReturn } from "@/lib/db/billing";
import { getAccountLabels, getUserAccounts } from "@/lib/db/accounts";
import { getManageableCategories, getUserCategories } from "@/lib/db/categories";
import { getManageableTags } from "@/lib/db/tags";
import { getManageableFavorites } from "@/lib/db/favorites";
import { Avatar } from "@/components/ui/avatar";
import { SubmitButton } from "@/components/auth/submit-button";
import { PlanBadge } from "@/components/settings/plan-badge";
import { ManageCategories } from "@/components/categories/manage-categories";
import { ManageTags } from "@/components/tags/manage-tags";
import { ManageFavorites } from "@/components/favorites/manage-favorites";
import { SettingsNameForm } from "@/components/settings/settings-name-form";
import { AnalyticsPreferenceForm } from "@/components/settings/analytics-preference-form";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { DeleteAccountDialog } from "@/components/settings/delete-account-dialog";
import {
  BillingActions,
  type CheckoutResult,
} from "@/components/settings/billing-actions";
import { ExportLinks } from "@/components/accounts/export-links";
import { signOutAction } from "@/actions/auth";

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

  // Settings is the account-management surface and an escape hatch — reachable
  // for a zero-account user, so it is NOT behind requireOnboarded().
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
  const [
    accountLabels,
    activeAccounts,
    categories,
    userCategories,
    tags,
    favorites,
  ] = await Promise.all([
    getAccountLabels(session.user.id),
    getUserAccounts(session.user.id),
    getManageableCategories(session.user.id),
    getUserCategories(session.user.id),
    getManageableTags(session.user.id),
    getManageableFavorites(session.user.id),
  ]);
  const scoped = requestedAccountId
    ? accountLabels.find((a) => a.id === requestedAccountId)
    : undefined;
  const exportAccountId = scoped?.id;
  const scopeLabel = scoped
    ? `${scoped.name}${scoped.isArchived ? " (archived)" : ""}`
    : "All accounts";

  const memberSince = user.createdAt.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  // Password change is only meaningful for email/password accounts; OAuth-only
  // users have no password to verify against.
  const hasPassword = user.password !== null;

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
        <div className="mt-4 flex items-center gap-4">
          <Avatar
            name={user.name}
            email={user.email}
            image={user.image}
            className="h-14 w-14"
            textClassName="text-[18px]"
          />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-medium text-ink">
              {user.name?.trim() || "Account"}
            </p>
            <p className="truncate text-[12px] text-ink-2">{user.email}</p>
            <p className="mt-0.5 text-[11px] text-ink-3">
              Member since {memberSince}
            </p>
          </div>
        </div>
        <div className="mt-5 border-t border-line pt-5">
          <p className="text-[12px] text-ink-2">
            Update how your name appears across Spendly.
          </p>
          <SettingsNameForm name={user.name} email={user.email} />
        </div>
        <div className="mt-5 border-t border-line pt-5">
          <p className="text-[12px] text-ink-2">
            Choose whether Spendly may collect usage signals to improve the
            product.
          </p>
          <AnalyticsPreferenceForm enabled={!user.analyticsOptOut} />
        </div>
      </section>

      {/* Security */}
      <section
        aria-labelledby="security-heading"
        className="rounded-xl border border-line bg-surface p-6"
      >
        <h2 id="security-heading" className="text-[13px] font-medium text-ink">
          Security
        </h2>
        {hasPassword && (
          <div className="mt-4 border-t border-line pt-4">
            <ChangePasswordForm />
          </div>
        )}
        <form
          action={signOutAction}
          className="mt-4 border-t border-line pt-4"
        >
          <SubmitButton className="bg-surface-2 text-ink hover:bg-surface-2/70">
            Sign out
          </SubmitButton>
        </form>
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

      {/* Categories */}
      <ManageCategories categories={categories} />

      {/* Tags */}
      <ManageTags tags={tags} />

      {/* Favorites */}
      <ManageFavorites
        favorites={favorites}
        categories={userCategories}
        accounts={activeAccounts}
      />

      {/* Data & privacy */}
      <section
        aria-labelledby="data-privacy-heading"
        className="rounded-xl border border-line bg-surface p-6"
      >
        <h2
          id="data-privacy-heading"
          className="text-[13px] font-medium text-ink"
        >
          Data &amp; privacy
        </h2>
        <div className="mt-4 rounded-lg border border-success/30 bg-success/10 p-4">
          <p className="text-[12px] font-medium text-ink">
            Exporting before you delete?
          </p>
          <p className="mt-1 text-[12px] text-ink-2">
            Download a copy of your data — deletion is permanent after the grace
            period. Exporting:{" "}
            <span className="font-medium text-ink">{scopeLabel}</span>
          </p>
          <div className="mt-4">
            <ExportLinks accountId={exportAccountId} />
          </div>
        </div>
        <div className="mt-4 rounded-lg border border-info/30 bg-info/10 p-4">
          <p className="text-[12px] font-medium text-ink">
            Migrating from another app?
          </p>
          <p className="mt-1 text-[12px] text-ink-2">
            Bring your history in from a CSV or a Spendly JSON export. You map the
            columns and review a preview before anything is saved.
          </p>
          <div className="mt-4">
            <Link
              href="/import"
              className="flex items-center justify-center gap-1.5 rounded-lg border border-line bg-surface-2 px-3.5 py-2 text-[13px] font-medium text-ink shadow-sm transition-colors hover:border-info/50 hover:text-info"
            >
              <Upload size={15} />
              Import data
            </Link>
          </div>
        </div>

        {/* Delete account — danger-tinted inner card, kept last (§3 D7) */}
        <div className="mt-4">
          <DeleteAccountDialog email={user.email} />
        </div>
      </section>
    </div>
  );
}
