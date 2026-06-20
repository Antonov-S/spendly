"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { ONBOARDING_COPY } from "@/lib/constants";

/**
 * Step 3 — confirmation. The mandatory account already exists, so the guard now
 * passes; the CTA simply navigates to the dashboard.
 */
export function OnboardingDoneStep() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleGo() {
    startTransition(() => {
      router.push("/dashboard");
    });
  }

  return (
    <button
      type="button"
      onClick={handleGo}
      disabled={isPending}
      className="flex h-9 w-full items-center justify-center gap-2 rounded-md bg-success text-[13px] font-medium text-white transition-colors hover:bg-success/90 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {isPending && <Loader2 size={15} className="animate-spin" />}
      {ONBOARDING_COPY.done.cta}
    </button>
  );
}
