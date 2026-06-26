"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  createTransaction,
  createTransfer,
  deleteTransaction,
  getDrawerFormData,
  getTransactionForEdit,
  restoreTransaction,
  updateTransaction,
  updateTransfer,
  type MutationResult,
} from "@/actions/transactions";
import { suggestCategory } from "@/actions/ai/suggest-category";
import { trackCategoryOutcome } from "@/actions/ai/track-outcome";
import { CategoryPickerField } from "@/components/categories/category-picker-field";
import { TRANSACTION_TYPE_OPTIONS } from "@/lib/constants";
import { BREAKPOINTS } from "@/lib/system-constants";
import { todayDateInputValue } from "@/lib/date";
import { getDefaultActiveAccount } from "@/lib/account";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import type { DrawerFormData, TransactionTypeValue } from "@/types/transactions";

interface TransactionDrawerProps {
  open: boolean;
  /** Transaction id to edit; null = create mode. */
  editId: string | null;
  onClose: () => void;
}

export function TransactionDrawer({
  open,
  editId,
  onClose,
}: TransactionDrawerProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const scopedAccountId = searchParams.get("account");
  const isDesktop = useMediaQuery(`(min-width: ${BREAKPOINTS.mobile}px)`);
  const [isPending, startTransition] = useTransition();

  const [formData, setFormData] = useState<DrawerFormData | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form fields
  const [type, setType] = useState<TransactionTypeValue>("EXPENSE");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayDateInputValue);
  const [categoryId, setCategoryId] = useState("");
  const [accountId, setAccountId] = useState("");
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [merchant, setMerchant] = useState("");
  const [note, setNote] = useState("");
  const [transferPairId, setTransferPairId] = useState<string | null>(null);

  // AI category suggestion (Pro). `suggestedCategoryId` is retained so Save can
  // tell accept from override for telemetry; reset whenever the drawer reopens.
  const [isSuggesting, startSuggesting] = useTransition();
  const [suggestedCategoryId, setSuggestedCategoryId] = useState<string | null>(
    null
  );
  const [suggestionPromptVersion, setSuggestionPromptVersion] = useState<
    number | null
  >(null);
  const [suggestionConfidence, setSuggestionConfidence] = useState<
    "high" | "low" | null
  >(null);
  const [suggestedMerchant, setSuggestedMerchant] = useState<string | null>(
    null
  );
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  // Monotonic token for the current drawer session. Bumped on close/reopen so a
  // slow suggestion that resolves after the drawer changed is discarded instead
  // of landing on a fresh (possibly different) transaction.
  const suggestRunRef = useRef(0);

  const isEdit = editId !== null;
  const isTransfer = type === "TRANSFER";
  const isPro = formData?.isPro ?? false;
  // The model needs free-text to categorize; an amount alone is no signal.
  const hasSuggestInput =
    merchant.trim().length > 0 || note.trim().length > 0;

  // Load selectors + (in edit mode) pre-fill whenever the drawer opens.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setError(null);
    // Clear any prior suggestion so a reopened drawer starts clean.
    setSuggestedCategoryId(null);
    setSuggestionPromptVersion(null);
    setSuggestionConfidence(null);
    setSuggestedMerchant(null);
    setSuggestNote(null);

    getDrawerFormData().then((res) => {
      if (active && res.success && res.data) setFormData(res.data);
    });

    if (editId) {
      setLoadingEdit(true);
      getTransactionForEdit(editId).then((res) => {
        if (!active) return;
        setLoadingEdit(false);
        if (!res.success || !res.data) {
          setError(res.error ?? "Could not load the transaction.");
          return;
        }
        const t = res.data;
        setType(t.type);
        setAmount(String(t.amount));
        setDate(t.date);
        setMerchant(t.merchant ?? "");
        setNote(t.note ?? "");
        if (t.type === "TRANSFER") {
          setTransferPairId(t.transferPairId ?? null);
          setFromAccountId(t.fromAccountId ?? "");
          setToAccountId(t.toAccountId ?? "");
        } else {
          setAccountId(t.financialAccountId ?? "");
          setCategoryId(t.categoryId ?? "");
        }
      });
    } else {
      // Create mode — reset to defaults.
      setType("EXPENSE");
      setAmount("");
      setDate(todayDateInputValue());
      setCategoryId("");
      setAccountId("");
      setFromAccountId("");
      setToAccountId("");
      setMerchant("");
      setNote("");
      setTransferPairId(null);
    }

    return () => {
      active = false;
      // Invalidate any in-flight suggestion: this drawer session is ending.
      suggestRunRef.current += 1;
    };
  }, [open, editId]);

  // Default the account selects once accounts load (create mode). The primary
  // account follows the topbar scope when active, else the first active account
  // (single source: getDefaultActiveAccount); the transfer "to" leg picks a
  // different account when one exists.
  useEffect(() => {
    if (!formData || isEdit) return;
    const accounts = formData.accounts;
    const primary = getDefaultActiveAccount(accounts, scopedAccountId);
    const other = accounts.find((a) => a.id !== primary?.id) ?? primary;
    setAccountId((prev) => prev || primary?.id || "");
    setFromAccountId((prev) => prev || primary?.id || "");
    setToAccountId((prev) => prev || other?.id || primary?.id || "");
  }, [formData, isEdit, scopedAccountId]);

  const accounts = formData?.accounts ?? [];
  const categories = formData?.categories ?? [];
  const noAccounts = formData !== null && accounts.length === 0;
  const busy = isPending || loadingEdit;

  function handleSuggest() {
    if (!hasSuggestInput) return; // nothing to categorize
    setSuggestNote(null);
    setSuggestedMerchant(null);
    setSuggestionConfidence(null);
    setSuggestedCategoryId(null);
    setSuggestionPromptVersion(null);
    const myRun = suggestRunRef.current;
    startSuggesting(async () => {
      const res = await suggestCategory({
        type: type as "INCOME" | "EXPENSE", // button only renders when !isTransfer
        merchant: merchant.trim() || null,
        note: note.trim() || null,
        amount: Number(amount) || null,
      });
      // Discard a result whose drawer session has since closed/reopened.
      if (suggestRunRef.current !== myRun) return;
      if (!res.success) {
        setSuggestNote(
          res.reason === "rate_limited"
            ? "You've hit the hourly suggestion limit — pick a category manually."
            : res.error
        );
        return;
      }
      const s = res.data;
      if (s.categoryId) {
        setCategoryId(s.categoryId);
        setSuggestedCategoryId(s.categoryId);
        setSuggestionConfidence(s.confidence);
        setSuggestionPromptVersion(s.promptVersion); // enables accept/override telemetry
      } else {
        // No usable match — leave the manual picker; show no "AI guess" hint.
        setSuggestedCategoryId(null);
        setSuggestionConfidence(null);
        setSuggestNote("No clear match — pick a category manually.");
      }
      // Offer merchant cleanup only when it's materially different from input.
      const trimmedMerchant = merchant.trim();
      setSuggestedMerchant(
        s.merchant && s.merchant !== trimmedMerchant ? s.merchant : null
      );
    });
  }

  function handleSubmit() {
    setError(null);
    const base = {
      amount: Number(amount),
      date,
      merchant: merchant.trim() || null,
      note: note.trim() || null,
    };

    startTransition(async () => {
      let res: MutationResult;
      if (type === "TRANSFER") {
        const payload = { ...base, fromAccountId, toAccountId };
        res =
          editId !== null && transferPairId
            ? await updateTransfer(transferPairId, payload)
            : await createTransfer(payload);
      } else {
        const payload = {
          ...base,
          type,
          financialAccountId: accountId,
          categoryId: categoryId || null,
        };
        res =
          editId !== null
            ? await updateTransaction(editId, payload)
            : await createTransaction(payload);
      }

      if (res.success) {
        // Telemetry: did the user keep the AI-suggested category? Only when a
        // suggestion was made for this (non-transfer) entry. Fire-and-forget.
        if (!isTransfer && suggestionPromptVersion !== null) {
          void trackCategoryOutcome({
            accepted:
              suggestedCategoryId !== null && categoryId === suggestedCategoryId,
            promptVersion: suggestionPromptVersion,
          });
        }
        onClose();
        toast.success(isEdit ? "Transaction updated" : "Transaction added");
        router.refresh();
      } else {
        setError(res.error ?? "Something went wrong.");
      }
    });
  }

  function handleDelete() {
    if (!editId) return;
    const id = editId;
    setError(null);
    startTransition(async () => {
      const res = await deleteTransaction(id);
      if (!res.success) {
        setError(res.error ?? "Could not delete the transaction.");
        return;
      }
      onClose();
      toast("Transaction deleted", {
        duration: 8000,
        action: {
          label: "Undo",
          onClick: async () => {
            const undo = await restoreTransaction(id);
            if (undo.success) router.refresh();
          },
        },
      });
      router.refresh();
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
          <SheetTitle>
            {isEdit ? "Edit transaction" : "Add transaction"}
          </SheetTitle>
          <SheetDescription className="sr-only">
            Enter the transaction details and save.
          </SheetDescription>
        </SheetHeader>

        {/* Form body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {/* Type toggle */}
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-app p-1">
            {TRANSACTION_TYPE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setType(option.value)}
                className={cn(
                  "rounded-md py-1.5 text-[12px] font-medium transition-colors",
                  type === option.value
                    ? "bg-surface-2 text-ink"
                    : "text-ink-3 hover:text-ink-2"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          {/* Amount */}
          <div className="mt-5">
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

          {/* Date */}
          <Field label="Date">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink outline-none"
            />
          </Field>

          {/* Category — hidden for transfers */}
          {!isTransfer && (
            <Field
              label="Category"
              action={
                isPro ? (
                  <button
                    type="button"
                    onClick={handleSuggest}
                    disabled={isSuggesting || !hasSuggestInput}
                    title={
                      !hasSuggestInput
                        ? "Add a merchant or note first"
                        : undefined
                    }
                    className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-ai transition-colors hover:bg-ai/10 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Sparkles className="size-3.5" />
                    {isSuggesting ? "Thinking…" : "Suggest"}
                  </button>
                ) : null
              }
            >
              <CategoryPickerField
                categories={categories}
                value={categoryId}
                onChange={(id) => {
                  setCategoryId(id);
                  // A manual change clears any "AI guess" hint styling.
                  setSuggestionConfidence(null);
                }}
                emptyLabel="Uncategorized"
              />
              {suggestionConfidence === "low" && (
                <p className="mt-1 text-[11px] text-ai">
                  AI guess — double-check it.
                </p>
              )}
              {suggestNote && (
                <p className="mt-1 text-[11px] text-ink-3">{suggestNote}</p>
              )}
            </Field>
          )}

          {/* Account(s) */}
          {isTransfer ? (
            <>
              <Field label="From account">
                <AccountSelect
                  value={fromAccountId}
                  onChange={setFromAccountId}
                  accounts={accounts}
                />
              </Field>
              <Field label="To account">
                <AccountSelect
                  value={toAccountId}
                  onChange={setToAccountId}
                  accounts={accounts}
                />
              </Field>
            </>
          ) : (
            <Field label="Account">
              <AccountSelect
                value={accountId}
                onChange={setAccountId}
                accounts={accounts}
              />
            </Field>
          )}

          {/* Merchant (optional) */}
          <Field label="Merchant" optional>
            <input
              type="text"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              placeholder="e.g. Whole Foods"
              className="w-full rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3"
            />
            {suggestedMerchant && (
              <button
                type="button"
                onClick={() => {
                  setMerchant(suggestedMerchant);
                  setSuggestedMerchant(null);
                }}
                className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-ai/30 bg-ai/5 px-2 py-1 text-[11px] text-ai transition-colors hover:bg-ai/10"
              >
                <Sparkles className="size-3" />
                Use “{suggestedMerchant}”?
              </button>
            )}
          </Field>

          {/* Note (optional) */}
          <Field label="Note" optional>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note…"
              className="w-full resize-none rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3"
            />
          </Field>
        </div>

        {/* Footer */}
        <SheetFooter>
          {error && <p className="text-[12px] text-danger">{error}</p>}
          {noAccounts && (
            <p className="text-[12px] text-ink-3">
              You need an account first.{" "}
              <Link
                href="/accounts"
                onClick={onClose}
                className="text-info underline-offset-2 hover:underline"
              >
                Create an account
              </Link>{" "}
              to start adding transactions.
            </p>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={busy || noAccounts}
            className="w-full rounded-lg bg-success py-2.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save transaction"}
          </button>
          {isEdit && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={busy}
              className="w-full rounded-lg border border-line py-2.5 text-[13px] font-medium text-danger transition-colors hover:bg-surface-2 disabled:opacity-60"
            >
              Delete transaction
            </button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function AccountSelect({
  value,
  onChange,
  accounts,
}: {
  value: string;
  onChange: (id: string) => void;
  accounts: DrawerFormData["accounts"];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink outline-none"
    >
      {accounts.length === 0 && <option value="">No accounts</option>}
      {accounts.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </select>
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
  action,
  children,
}: {
  label: string;
  optional?: boolean;
  /** Optional control rendered inline-end of the label row (e.g. AI Suggest). */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between">
        <Label>
          {label}
          {optional && (
            <span className="ml-1 font-normal text-ink-3">(optional)</span>
          )}
        </Label>
        {action}
      </div>
      {children}
    </div>
  );
}
