"use client";

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { CategoryIcon } from "@/components/dashboard/category-icon";
import { formatCurrency } from "@/lib/format";
import { resolveIcon } from "@/lib/icon-map";
import { ACCOUNT_TYPE_OPTIONS } from "@/lib/constants";
import { SEMANTIC_COLORS } from "@/lib/system-constants";
import { cn } from "@/lib/utils";
import type { AccountListRow, AccountTypeValue } from "@/types/accounts";

interface AccountListProps {
  accounts: AccountListRow[];
  onEdit: (id: string) => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  busy: boolean;
}

const TYPE_LABELS = new Map<AccountTypeValue, string>(
  ACCOUNT_TYPE_OPTIONS.map((o) => [o.value, o.label])
);

/**
 * Format a derived balance with a leading minus for negatives (liability
 * accounts). `formatCurrency` strips the sign, so it's reapplied here.
 */
function formatBalance(balance: number): string {
  return balance < 0 ? `−${formatCurrency(balance)}` : formatCurrency(balance);
}

export function AccountList({
  accounts,
  onEdit,
  onArchive,
  onUnarchive,
  busy,
}: AccountListProps) {
  const active = accounts.filter((a) => !a.isArchived);
  const archived = accounts.filter((a) => a.isArchived);

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col rounded-xl border border-line bg-surface">
        <ul className="flex flex-col">
          {active.map((account) => (
            <AccountRowItem
              key={account.id}
              account={account}
              onEdit={onEdit}
              onArchive={onArchive}
              onUnarchive={onUnarchive}
              busy={busy}
            />
          ))}
        </ul>
      </section>

      {archived.length > 0 && (
        <section className="flex flex-col rounded-xl border border-line bg-surface">
          <div className="border-b border-line px-4 py-2.5">
            <p className="text-[10px] font-medium uppercase tracking-wide text-ink-3">
              Archived
            </p>
          </div>
          <ul className="flex flex-col">
            {archived.map((account) => (
              <AccountRowItem
                key={account.id}
                account={account}
                onEdit={onEdit}
                onArchive={onArchive}
                onUnarchive={onUnarchive}
                busy={busy}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function AccountRowItem({
  account,
  onEdit,
  onArchive,
  onUnarchive,
  busy,
}: {
  account: AccountListRow;
  onEdit: (id: string) => void;
  onArchive: (id: string) => void;
  onUnarchive: (id: string) => void;
  busy: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isArchived = account.isArchived;
  const category = {
    name: account.name,
    color: account.color ?? SEMANTIC_COLORS.neutral,
    icon: resolveIcon(account.icon ?? "Wallet"),
  };

  return (
    <li className="relative border-b border-line last:border-b-0">
      <button
        type="button"
        onClick={() => onEdit(account.id)}
        className={cn(
          "flex w-full items-center gap-2.5 px-4 py-3.5 text-left transition-colors hover:bg-surface-2",
          isArchived && "opacity-60"
        )}
      >
        <CategoryIcon category={category} size="md" />
        <div className="flex flex-col">
          <span className="text-[12px] text-ink">{account.name}</span>
          <span className="text-[10px] text-ink-3">
            {TYPE_LABELS.get(account.type) ?? account.type} · {account.currency}
          </span>
        </div>
        <span className="ml-auto mr-8 text-[13px] font-medium tabular-nums text-ink">
          {formatBalance(account.balance)}
        </span>
      </button>

      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label="Account actions"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <MoreHorizontal size={16} />
      </button>

      {menuOpen && (
        <>
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setMenuOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div
            role="menu"
            className="absolute right-3 top-12 z-50 min-w-36 overflow-hidden rounded-lg border border-line bg-surface shadow-lg"
          >
            {!isArchived && (
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  setMenuOpen(false);
                  onEdit(account.id);
                }}
                className="w-full px-3 py-2 text-left text-[12px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-60"
              >
                Edit account
              </button>
            )}
            {isArchived ? (
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  setMenuOpen(false);
                  onUnarchive(account.id);
                }}
                className="w-full px-3 py-2 text-left text-[12px] text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink disabled:opacity-60"
              >
                Unarchive account
              </button>
            ) : (
              <button
                type="button"
                role="menuitem"
                disabled={busy}
                onClick={() => {
                  setMenuOpen(false);
                  onArchive(account.id);
                }}
                className="w-full px-3 py-2 text-left text-[12px] text-danger transition-colors hover:bg-surface-2 disabled:opacity-60"
              >
                Archive account
              </button>
            )}
          </div>
        </>
      )}
    </li>
  );
}
