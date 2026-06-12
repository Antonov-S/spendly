import { cn } from "@/lib/utils";

interface InputFormFieldProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Per-field validation message shown beneath the input. */
  error?: string;
}

/** Labeled text input with inline error, matching the dark auth-card styling. */
export function InputFormField({
  label,
  error,
  id,
  className,
  ...props
}: InputFormFieldProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[12px] font-medium text-ink-2">
        {label}
      </label>
      <input
        id={id}
        className={cn(
          "rounded-md border border-line bg-app px-3 py-2 text-[13px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-ink-3",
          error && "border-danger focus:border-danger",
          className
        )}
        aria-invalid={error ? true : undefined}
        {...props}
      />
      {error && <span className="text-[11px] text-danger">{error}</span>}
    </div>
  );
}
