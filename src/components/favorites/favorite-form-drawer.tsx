"use client";

import { useState, useTransition } from "react";
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
import { CategoryPickerField } from "@/components/categories/category-picker-field";
import { updateFavorite } from "@/actions/favorites";
import {
  BREAKPOINTS,
  FAVORITE_NAME_MAX,
  MERCHANT_MAX,
  NOTE_MAX,
} from "@/lib/system-constants";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import type { ManageableFavorite } from "@/types/favorites";
import type { AccountOption, CategoryOption } from "@/types/transactions";

interface FavoriteFormDrawerProps {
  favorite: ManageableFavorite | null;
  open: boolean;
  formKey: number;
  categories: CategoryOption[];
  accounts: AccountOption[];
  onClose: () => void;
}

export function FavoriteFormDrawer({
  favorite,
  open,
  formKey,
  categories,
  accounts,
  onClose,
}: FavoriteFormDrawerProps) {
  if (!favorite) return null;

  return (
    <FavoriteFormDrawerBody
      key={formKey}
      favorite={favorite}
      open={open}
      categories={categories}
      accounts={accounts}
      onClose={onClose}
    />
  );
}

function FavoriteFormDrawerBody({
  favorite,
  open,
  categories,
  accounts,
  onClose,
}: Omit<FavoriteFormDrawerProps, "favorite" | "formKey"> & {
  favorite: ManageableFavorite;
}) {
  const router = useRouter();
  const isDesktop = useMediaQuery(`(min-width: ${BREAKPOINTS.mobile}px)`);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(favorite.name);
  const [type, setType] = useState<"INCOME" | "EXPENSE">(favorite.type);
  const [amount, setAmount] = useState(
    favorite.amount === null ? "" : String(favorite.amount)
  );
  const [categoryId, setCategoryId] = useState(favorite.categoryId ?? "");
  const [accountId, setAccountId] = useState(
    favorite.accountArchived ? "" : (favorite.financialAccountId ?? "")
  );
  const [merchant, setMerchant] = useState(favorite.merchant ?? "");
  const [note, setNote] = useState(favorite.note ?? "");

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const res = await updateFavorite(favorite.id, {
        name,
        type,
        amount: amount.trim().length > 0 ? Number(amount) : null,
        categoryId: categoryId || null,
        financialAccountId: accountId || null,
        merchant: merchant.trim() || null,
        note: note.trim() || null,
      });

      if (res.success) {
        toast.success("Favorite updated");
        onClose();
        router.refresh();
      } else {
        setError(res.error ?? "Could not update the favorite.");
      }
    });
  }

  const busy = isPending;
  const canSubmit = name.trim().length > 0;

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
          <SheetTitle>Edit favorite</SheetTitle>
          <SheetDescription className="sr-only">
            Edit the saved transaction shortcut.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          <Field label="Name">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={FAVORITE_NAME_MAX}
              className="w-full rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3"
            />
          </Field>

          <Field label="Type">
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-app p-1">
              {(["EXPENSE", "INCOME"] as const).map((option) => (
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
                  {option === "EXPENSE" ? "Expense" : "Income"}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Amount" optional>
            <div className="flex items-center rounded-lg border border-line bg-app px-3">
              <span className="text-[18px] font-medium text-ink-3">€</span>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="Ask every time"
                className="w-full bg-transparent py-2 pl-1 text-[15px] font-medium text-ink outline-none placeholder:text-ink-3"
              />
            </div>
            <p className="mt-1 text-[11px] text-ink-3">
              Leave blank to ask every time.
            </p>
          </Field>

          <Field label="Category" optional>
            <CategoryPickerField
              categories={categories}
              value={categoryId}
              onChange={setCategoryId}
              emptyLabel="Uncategorized"
            />
          </Field>

          <Field label="Account" optional>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="w-full rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink outline-none"
            >
              <option value="">Drawer default</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
            {favorite.accountArchived && favorite.accountName && (
              <p className="mt-1 text-[11px] text-warning">
                Previously used {favorite.accountName}, now archived.
              </p>
            )}
          </Field>

          <Field label="Merchant" optional>
            <input
              type="text"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              maxLength={MERCHANT_MAX}
              className="w-full rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3"
            />
          </Field>

          <Field label="Note" optional>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={NOTE_MAX}
              className="w-full resize-none rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3"
            />
          </Field>
        </div>

        <SheetFooter>
          {error && <p className="text-[12px] text-danger">{error}</p>}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={busy || !canSubmit}
            className="w-full rounded-lg bg-success py-2.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Saving..." : "Save favorite"}
          </button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
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
    <div className="mt-4 first:mt-0">
      <label className="mb-1.5 block text-[11px] font-medium text-ink-2">
        {label}
        {optional && (
          <span className="ml-1 font-normal text-ink-3">(optional)</span>
        )}
      </label>
      {children}
    </div>
  );
}
