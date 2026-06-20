"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Logo } from "@/components/dashboard/logo";
import { Toaster } from "@/components/ui/sonner";
import { OnboardingAccountStep } from "./onboarding-account-step";
import { OnboardingBudgetsStep } from "./onboarding-budgets-step";
import { OnboardingDoneStep } from "./onboarding-done-step";
import {
  ONBOARDING_COPY,
  ONBOARDING_STEP_COUNT,
  ONBOARDING_STEP_PARAM,
  ONBOARDING_STEP_VALUES,
} from "@/lib/constants";
import { cn } from "@/lib/utils";

interface OnboardingFlowProps {
  /** The user's display name, for the greeting. Null for unnamed accounts. */
  userName: string | null;
  /** Step to start on — derived server-side so a reload resumes correctly. */
  initialStep: 1 | 2 | 3;
}

type Step = 1 | 2 | 3;

const STEP_HEADINGS: Record<Step, { title: string; subtitle: string }> = {
  1: ONBOARDING_COPY.account,
  2: ONBOARDING_COPY.budgets,
  3: ONBOARDING_COPY.done,
};

/**
 * Client coordinator for the 3-step first-run flow. Step transitions are
 * mirrored into the URL (`?step=`) so the page's reverse guard treats a
 * mid-flow Server Action refresh as in-progress rather than a completed-user
 * revisit. `initialStep` lets a reload resume at the right step.
 */
export function OnboardingFlow({ userName, initialStep }: OnboardingFlowProps) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(initialStep);
  const heading = STEP_HEADINGS[step];

  // Step 1 marks ?step=budgets itself (before its mutation, to beat the
  // reverse guard); here we only advance the local step.
  function goToBudgets() {
    setStep(2);
  }

  // Budgets → done: the seed mutation has already refreshed at ?step=budgets
  // (in-flow, no bounce), so updating the marker here is race-free.
  function goToDone() {
    router.replace(`/onboarding?${ONBOARDING_STEP_PARAM}=${ONBOARDING_STEP_VALUES.done}`, {
      scroll: false,
    });
    setStep(3);
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-app px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>

        <div className="rounded-xl border border-line bg-surface p-6">
          {/* Progress dots */}
          <div className="mb-5 flex items-center gap-2">
            {Array.from({ length: ONBOARDING_STEP_COUNT }, (_, i) => i + 1).map(
              (n) => (
                <span
                  key={n}
                  className={cn(
                    "h-1.5 flex-1 rounded-full transition-colors",
                    n <= step ? "bg-success" : "bg-line"
                  )}
                />
              )
            )}
          </div>
          <p className="mb-4 text-[11px] font-medium uppercase tracking-wide text-ink-3">
            Step {step} of {ONBOARDING_STEP_COUNT}
          </p>

          <h1 className="text-[18px] font-medium text-ink">
            {step === 1 && userName ? `Welcome, ${userName}` : heading.title}
          </h1>
          <p className="mt-1 text-[12px] text-ink-2">{heading.subtitle}</p>

          <div className="mt-5">
            {step === 1 && <OnboardingAccountStep onCreated={goToBudgets} />}
            {step === 2 && <OnboardingBudgetsStep onDone={goToDone} />}
            {step === 3 && <OnboardingDoneStep />}
          </div>
        </div>
      </div>
      <Toaster />
    </div>
  );
}
