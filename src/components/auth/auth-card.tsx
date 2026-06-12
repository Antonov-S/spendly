import { Logo } from "@/components/dashboard/logo";

interface AuthCardProps {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  /** Secondary line under the card (e.g. link to the other auth page). */
  footer?: React.ReactNode;
}

/** Centered card shell shared by the sign-in and register pages. */
export function AuthCard({ title, subtitle, children, footer }: AuthCardProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-app px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo />
        </div>

        <div className="rounded-xl border border-line bg-surface p-6">
          <h1 className="text-[18px] font-medium text-ink">{title}</h1>
          <p className="mt-1 text-[12px] text-ink-2">{subtitle}</p>
          <div className="mt-5">{children}</div>
        </div>

        {footer && (
          <p className="mt-5 text-center text-[12px] text-ink-2">{footer}</p>
        )}
      </div>
    </div>
  );
}
