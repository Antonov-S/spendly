"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  createTemplate,
  updateTemplate,
  getTemplateForEdit,
  type MutationResult,
} from "@/actions/recurring";
import { CADENCE_OPTIONS } from "@/lib/constants";
import { BREAKPOINTS } from "@/lib/system-constants";
import { useMediaQuery } from "@/hooks/use-media-query";
import { todayDateInputValue } from "@/lib/date";
import { cn } from "@/lib/utils";
import type { RecurringType } from "@/lib/recurring";
import type { AccountOption, CategoryOption } from "@/types/transactions";

interface TemplateFormDrawerProps {
  open: boolean;
  /** Template id to edit; null = create mode. */
  editId: string | null;
  accounts: AccountOption[];
  categories: CategoryOption[];
  onClose: () => void;
}

const TYPE_OPTIONS: { value: RecurringType; label: string }[] = [
  { value: "INCOME", label: "Income" },
  { value: "EXPENSE", label: "Expense" },
];

export function TemplateFormDrawer({
  open,
  editId,
  accounts,
  categories,
  onClose,
}: TemplateFormDrawerProps) {
  const router = useRouter();
  const isDesktop = useMediaQuery(`(min-width: ${BREAKPOINTS.mobile}px)`);
  const [isPending, startTransition] = useTransition();

  const [loadingEdit, setLoadingEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<RecurringType>("EXPENSE");
  const [amount, setAmount] = useState("");
  const [cadence, setCadence] = useState<string>("MONTHLY");
  const [nextOccurrence, setNextOccurrence] = useState(todayDateInputValue());
  const [accountId, setAccountId] = useState("");
  const [categoryId, setCategoryId] = useState("");

  const isEdit = editId !== null;

  // Reset / pre-fill whenever the drawer opens.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setError(null);

    if (editId) {
      setLoadingEdit(true);
      getTemplateForEdit(editId).then((res) => {
        if (!active) return;
        setLoadingEdit(false);
        if (!res.success || !res.data) {
          setError(res.error ?? "Could not load the template.");
          return;
        }
        setName(res.data.name);
        setType(res.data.type);
        setAmount(String(res.data.amount));
        setCadence(res.data.cadence);
        setNextOccurrence(res.data.nextOccurrence);
        setAccountId(res.data.financialAccountId);
        setCategoryId(res.data.categoryId ?? "");
      });
    } else {
      setName("");
      setType("EXPENSE");
      setAmount("");
      setCadence("MONTHLY");
      setNextOccurrence(todayDateInputValue());
      setAccountId(accounts[0]?.id ?? "");
      setCategoryId("");
    }

    return () => {
      active = false;
    };
  }, [open, editId, accounts]);

  const noAccounts = !isEdit && accounts.length === 0;
  const busy = isPending || loadingEdit;

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      let res: MutationResult;
      if (editId !== null) {
        res = await updateTemplate(editId, {
          name,
          amount: Number(amount),
          cadence: cadence as (typeof CADENCE_OPTIONS)[number]["value"],
        });
      } else {
        res = await createTemplate({
          name,
          type,
          amount: Number(amount),
          cadence: cadence as (typeof CADENCE_OPTIONS)[number]["value"],
          nextOccurrence,
          financialAccountId: accountId,
          categoryId: categoryId || undefined,
        });
      }

      if (res.success) {
        onClose();
        toast.success(isEdit ? "Template updated" : "Template created");
        router.refresh();
      } else {
        setError(res.error ?? "Something went wrong.");
      }
    });
  }

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side={isDesktop ? "right" : "bottom"}
        className={cn(
          "gap-0 p-0",
          isDesktop
            ? "w-full sm:max-w-105"
            : "h-[90vh] rounded-t-2xl border-t border-line"
        )}
      >
        <SheetHeader>
          <SheetTitle>{isEdit ? "Edit template" : "New template"}</SheetTitle>
          <SheetDescription className="sr-only">
            Set up a standing rule that suggests a transaction each period.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {/* Type — fixed in edit mode */}
          <div className="mb-4">
            <Label>Type</Label>
            <div className="flex gap-1 rounded-lg border border-line bg-app p-1">
              {TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={isEdit}
                  onClick={() => setType(opt.value)}
                  className={cn(
                    "flex-1 rounded-md py-1.5 text-[12px] font-medium transition-colors disabled:opacity-60",
                    type === opt.value
                      ? "bg-surface text-ink"
                      : "text-ink-3 hover:text-ink"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Name */}
          <div className="mb-4">
            <Label>Name</Label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder="e.g. Netflix"
              className="w-full rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3"
            />
          </div>

          {/* Amount */}
          <div className="mb-4">
            <Label>Amount</Label>
            <div className="flex items-center rounded-lg border border-line bg-app px-3">
              <span className="text-[22px] font-medium text-ink-3">€</span>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full bg-transparent py-2.5 pl-1 text-[22px] font-medium text-ink outline-none placeholder:text-ink-3"
              />
            </div>
          </div>

          {/* Cadence */}
          <div className="mb-4">
            <Label>Cadence</Label>
            <select
              value={cadence}
              onChange={(e) => setCadence(e.target.value)}
              className="w-full rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink outline-none"
            >
              {CADENCE_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          {/* First occurrence — fixed in edit mode */}
          <div className="mb-4">
            <Label>First occurrence</Label>
            <input
              type="date"
              value={nextOccurrence}
              disabled={isEdit}
              onChange={(e) => setNextOccurrence(e.target.value)}
              className="w-full rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink outline-none disabled:opacity-60"
            />
          </div>

          {/* Account — fixed in edit mode */}
          <div className="mb-4">
            <Label>Account</Label>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              disabled={isEdit || noAccounts}
              className="w-full rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink outline-none disabled:opacity-60"
            >
              {noAccounts && <option value="">No accounts</option>}
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          {/* Category — optional, fixed in edit mode */}
          <div>
            <Label>Category (optional)</Label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              disabled={isEdit}
              className="w-full rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink outline-none disabled:opacity-60"
            >
              <option value="">No category</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <SheetFooter>
          {error && <p className="text-[12px] text-danger">{error}</p>}
          {noAccounts && (
            <p className="text-[12px] text-ink-3">
              Create a financial account first.
            </p>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={busy || noAccounts}
            className="w-full rounded-lg bg-success py-2.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Saving…" : isEdit ? "Save changes" : "Create template"}
          </button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="mb-1.5 block text-[11px] font-medium text-ink-2">
      {children}
    </label>
  );
}
