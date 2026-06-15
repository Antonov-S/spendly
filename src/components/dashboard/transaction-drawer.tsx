"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { TRANSACTION_TYPES } from "@/lib/system-constants";
import type { TransactionTypeLabel } from "@/lib/system-constants";
import { MOCK_ACCOUNTS, MOCK_CATEGORIES } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

interface TransactionDrawerProps {
  open: boolean;
  onClose: () => void;
}

// Real financial accounts (drop the "All accounts" filter pseudo-option).
const ACCOUNT_OPTIONS = MOCK_ACCOUNTS.slice(1);

export function TransactionDrawer({ open, onClose }: TransactionDrawerProps) {
  const [type, setType] = useState<TransactionTypeLabel>("Expense");

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        aria-hidden
        className={cn(
          "fixed inset-0 z-40 bg-black/60 transition-opacity duration-300",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
      />

      {/* Panel: bottom sheet on mobile, right drawer from md up */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Add transaction"
        aria-hidden={!open}
        className={cn(
          "fixed z-50 flex flex-col bg-surface transition-transform duration-300 ease-in-out",
          "inset-x-0 bottom-0 h-[90vh] rounded-t-2xl border-t border-line",
          "md:inset-y-0 md:left-auto md:right-0 md:h-full md:w-105 md:rounded-none md:border-l md:border-t-0",
          open
            ? "translate-y-0 md:translate-x-0"
            : "translate-y-full md:translate-y-0 md:translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-[14px] font-medium text-ink">Add transaction</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-7 w-7 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>

        {/* Form body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {/* Type toggle */}
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-app p-1">
            {TRANSACTION_TYPES.map(option => (
              <button
                key={option}
                type="button"
                onClick={() => setType(option)}
                className={cn(
                  "rounded-md py-1.5 text-[12px] font-medium transition-colors",
                  type === option
                    ? "bg-surface-2 text-ink"
                    : "text-ink-3 hover:text-ink-2"
                )}
              >
                {option}
              </button>
            ))}
          </div>

          {/* Amount */}
          <div className="mt-5">
            <Label>Amount</Label>
            <div className="flex items-center rounded-lg border border-line bg-app px-3">
              <span className="text-[22px] font-medium text-ink-3">$</span>
              <input
                type="text"
                inputMode="decimal"
                defaultValue="0.00"
                className="w-full bg-transparent py-2.5 pl-1 text-[22px] font-medium text-ink outline-none placeholder:text-ink-3"
              />
            </div>
          </div>

          {/* Date */}
          <Field label="Date">
            <input
              type="date"
              defaultValue="2026-06-04"
              className="w-full rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink outline-none [scheme:dark]"
            />
          </Field>

          {/* Category */}
          <Field label="Category">
            <select
              defaultValue="Groceries"
              className="w-full rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink outline-none"
            >
              {MOCK_CATEGORIES.map(name => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </Field>

          {/* Account */}
          <Field label="Account">
            <select
              defaultValue={ACCOUNT_OPTIONS[0]}
              className="w-full rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink outline-none"
            >
              {ACCOUNT_OPTIONS.map(name => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </Field>

          {/* Merchant (optional) */}
          <Field label="Merchant" optional>
            <input
              type="text"
              placeholder="e.g. Whole Foods"
              className="w-full rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3"
            />
          </Field>

          {/* Note (optional) */}
          <Field label="Note" optional>
            <textarea
              rows={2}
              placeholder="Add a note…"
              className="w-full resize-none rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3"
            />
          </Field>
        </div>

        {/* Footer */}
        <div className="border-t border-line px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="w-full rounded-lg bg-success py-2.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
          >
            Save transaction
          </button>
        </div>
      </aside>
    </>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-[11px] font-medium text-ink-2">
      {children}
    </label>
  );
}

function Field({
  label,
  optional,
  children
}: {
  label: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4">
      <Label>
        {label}
        {optional && (
          <span className="ml-1 font-normal text-ink-3">(optional)</span>
        )}
      </Label>
      {children}
    </div>
  );
}
