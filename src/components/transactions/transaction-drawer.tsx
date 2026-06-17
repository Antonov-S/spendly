"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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

  const isEdit = editId !== null;
  const isTransfer = type === "TRANSFER";

  // Load selectors + (in edit mode) pre-fill whenever the drawer opens.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setError(null);

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
              <span className="text-[22px] font-medium text-ink-3">$</span>
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
            <Field label="Category">
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink outline-none"
              >
                <option value="">Uncategorized</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
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
  children,
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
