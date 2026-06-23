export const dynamic = "force-dynamic";

export const metadata = { title: "Get started" };

import {
  getSessionOrRedirect,
  redirectIfOnboarded,
} from "@/lib/auth/guards";
import { getActiveAccountCount } from "@/lib/db/accounts";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { ONBOARDING_STEP_PARAM, ONBOARDING_STEP_VALUES } from "@/lib/constants";

interface OnboardingPageProps {
  searchParams: Promise<{ [ONBOARDING_STEP_PARAM]?: string }>;
}

const IN_FLOW_STEPS: ReadonlySet<string> = new Set([
  ONBOARDING_STEP_VALUES.budgets,
  ONBOARDING_STEP_VALUES.done,
]);

/**
 * First-run flow. It is its own focused surface — no app sidebar/topbar chrome.
 *
 * Reverse guard: an already-onboarded user who arrives *fresh* (no `?step=`
 * marker) is sent to the dashboard. A mid-flow request (the `?step=` marker is
 * set by Step 1 before it creates the account) skips the bounce — otherwise the
 * Server Action's implicit /onboarding refresh would eject the user the instant
 * the account exists, before the budgets/done steps render.
 */
export default async function OnboardingPage({
  searchParams,
}: OnboardingPageProps) {
  const { [ONBOARDING_STEP_PARAM]: step } = await searchParams;
  const inFlow = typeof step === "string" && IN_FLOW_STEPS.has(step);

  const session = inFlow
    ? await getSessionOrRedirect()
    : await redirectIfOnboarded();

  // Resume at the right step on reload. A user with no account always starts at
  // Step 1 regardless of the marker (the account is the only mandatory step).
  const count = inFlow ? await getActiveAccountCount(session.user.id) : 0;
  const initialStep =
    count === 0 ? 1 : step === ONBOARDING_STEP_VALUES.done ? 3 : 2;

  return (
    <OnboardingFlow
      userName={session.user.name ?? null}
      initialStep={initialStep}
    />
  );
}
