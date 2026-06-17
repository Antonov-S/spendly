"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
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
  createFinancialAccount,
  updateFinancialAccount,
  getAccountForEdit,
  type MutationResult,
} from "@/actions/financial-accounts";
import {
  ACCOUNT_TYPE_OPTIONS,
  ACCOUNT_COLORS,
  ACCOUNT_ICONS,
} from "@/lib/constants";
import { BREAKPOINTS } from "@/lib/system-constants";
import { resolveIcon } from "@/lib/icon-map";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";
import type { AccountTypeValue } from "@/types/accounts";

interface AccountFormDrawerProps {
  open: boolean;
  /** Account id to edit; null = create mode. */
  editId: string | null;
  onClose: () => void;
}

type AccountIcon = (typeof ACCOUNT_ICONS)[number];

const DEFAULT_TYPE: AccountTypeValue = "CHECKING";

export function AccountFormDrawer({
  open,
  editId,
  onClose,
}: AccountFormDrawerProps) {
  const router = useRouter();
  const isDesktop = useMediaQuery(`(min-width: ${BREAKPOINTS.mobile}px)`);
  const [isPending, startTransition] = useTransition();

  const [loadingEdit, setLoadingEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountTypeValue>(DEFAULT_TYPE);
  const [startingBalance, setStartingBalance] = useState("");
  const [color, setColor] = useState<string>(ACCOUNT_COLORS[0]);
  const [icon, setIcon] = useState<AccountIcon>(ACCOUNT_ICONS[0]);

  const isEdit = editId !== null;

  // Reset / pre-fill whenever the drawer opens.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setError(null);

    if (editId) {
      setLoadingEdit(true);
      getAccountForEdit(editId).then((res) => {
        if (!active) return;
        setLoadingEdit(false);
        if (!res.success || !res.data) {
          setError(res.error ?? "Could not load the account.");
          return;
        }
        const a = res.data;
        setName(a.name);
        setType(a.type);
        setStartingBalance(String(a.startingBalance));
        setColor(a.color ?? ACCOUNT_COLORS[0]);
        setIcon(ACCOUNT_ICONS.find((i) => i === a.icon) ?? ACCOUNT_ICONS[0]);
      });
    } else {
      setName("");
      setType(DEFAULT_TYPE);
      setStartingBalance("");
      setColor(ACCOUNT_COLORS[0]);
      setIcon(ACCOUNT_ICONS[0]);
    }

    return () => {
      active = false;
    };
  }, [open, editId]);

  const busy = isPending || loadingEdit;

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      let res: MutationResult;
      if (editId !== null) {
        res = await updateFinancialAccount({ id: editId, name, color, icon });
      } else {
        res = await createFinancialAccount({
          name,
          type,
          startingBalance: Number(startingBalance || 0),
          color,
          icon,
        });
      }

      if (res.success) {
        onClose();
        toast.success(isEdit ? "Account updated" : "Account added");
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
          <SheetTitle>{isEdit ? "Edit account" : "Add account"}</SheetTitle>
          <SheetDescription className="sr-only">
            Name the account and set its type, starting balance, color, and icon.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-5">
          {/* Name */}
          <div>
            <Label>Name</Label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Checking"
              className="w-full rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3"
            />
          </div>

          {/* Type — immutable after create */}
          <div className="mt-4">
            <Label>Type</Label>
            {isEdit ? (
              <p className="rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink-2">
                {ACCOUNT_TYPE_OPTIONS.find((o) => o.value === type)?.label ??
                  type}
              </p>
            ) : (
              <select
                value={type}
                onChange={(e) => setType(e.target.value as AccountTypeValue)}
                className="w-full rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink outline-none"
              >
                {ACCOUNT_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Starting balance — immutable after create */}
          <div className="mt-4">
            <Label>Starting balance</Label>
            {isEdit ? (
              <p className="rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink-2">
                ${startingBalance || "0"}
              </p>
            ) : (
              <div className="flex items-center rounded-lg border border-line bg-app px-3">
                <span className="text-[22px] font-medium text-ink-3">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={startingBalance}
                  onChange={(e) => setStartingBalance(e.target.value)}
                  placeholder="0.00"
                  className="w-full bg-transparent py-2.5 pl-1 text-[22px] font-medium text-ink outline-none placeholder:text-ink-3"
                />
              </div>
            )}
            {!isEdit && (
              <p className="mt-1.5 text-[11px] text-ink-3">
                Use a negative value for a card or loan you already owe on.
              </p>
            )}
          </div>

          {/* Color */}
          <div className="mt-4">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {ACCOUNT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Color ${c}`}
                  aria-pressed={color === c}
                  className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-full transition-transform hover:scale-110",
                    color === c && "ring-2 ring-ink ring-offset-2 ring-offset-surface"
                  )}
                  style={{ backgroundColor: c }}
                >
                  {color === c && <Check size={14} className="text-white" />}
                </button>
              ))}
            </div>
          </div>

          {/* Icon */}
          <div className="mt-4">
            <Label>Icon</Label>
            <div className="flex flex-wrap gap-2">
              {ACCOUNT_ICONS.map((name) => {
                const Icon = resolveIcon(name);
                const selected = icon === name;
                return (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setIcon(name)}
                    aria-label={`Icon ${name}`}
                    aria-pressed={selected}
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-lg border transition-colors",
                      selected
                        ? "border-success bg-success/10 text-success"
                        : "border-line text-ink-2 hover:bg-surface-2 hover:text-ink"
                    )}
                  >
                    <Icon size={16} />
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <SheetFooter>
          {error && <p className="text-[12px] text-danger">{error}</p>}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={busy}
            className="w-full rounded-lg bg-success py-2.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save account"}
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
