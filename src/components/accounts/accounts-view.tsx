"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import {
  archiveFinancialAccount,
  unarchiveFinancialAccount,
} from "@/actions/financial-accounts";
import { AccountList } from "@/components/accounts/account-list";
import { AccountEmptyState } from "@/components/accounts/account-empty-state";
import { AccountFormDrawer } from "@/components/accounts/account-form-drawer";
import { ExportLinks } from "@/components/accounts/export-links";
import type { AccountListRow } from "@/types/accounts";

interface AccountsViewProps {
  accounts: AccountListRow[];
  /** Current topbar account scope carried onto the export links. */
  exportAccountId?: string;
}

interface DrawerState {
  open: boolean;
  editId: string | null;
}

export function AccountsView({ accounts, exportAccountId }: AccountsViewProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [drawer, setDrawer] = useState<DrawerState>({
    open: false,
    editId: null,
  });

  const openCreate = () => setDrawer({ open: true, editId: null });
  const openEdit = (id: string) => setDrawer({ open: true, editId: id });
  const closeDrawer = () => setDrawer((d) => ({ ...d, open: false }));

  function handleArchive(id: string) {
    startTransition(async () => {
      const res = await archiveFinancialAccount(id);
      if (!res.success) {
        toast.error(res.error ?? "Could not archive the account.");
        return;
      }
      toast("Account archived", {
        duration: 8000,
        action: {
          label: "Undo",
          onClick: async () => {
            const undo = await unarchiveFinancialAccount(id);
            if (undo.success) router.refresh();
            else toast.error(undo.error ?? "Could not restore the account.");
          },
        },
      });
      router.refresh();
    });
  }

  function handleUnarchive(id: string) {
    startTransition(async () => {
      const res = await unarchiveFinancialAccount(id);
      if (!res.success) {
        toast.error(res.error ?? "Could not restore the account.");
        return;
      }
      toast.success("Account restored");
      router.refresh();
    });
  }

  return (
    <>
      <header className="flex items-center gap-3">
        <div>
          <h1 className="text-[20px] font-medium leading-none text-ink">
            Accounts
          </h1>
          <p className="mt-1.5 text-[12px] text-ink-3">
            Your checking, savings, cash and card balances
          </p>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {/* Quiet secondary affordance; renders regardless of account count (D7). */}
          <ExportLinks accountId={exportAccountId} />

          <button
            type="button"
            onClick={openCreate}
            className="flex items-center gap-1.5 rounded-lg bg-success px-3 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
          >
            <Plus size={16} />
            <span className="hidden sm:inline">Add account</span>
          </button>
        </div>
      </header>

      {accounts.length === 0 ? (
        <AccountEmptyState onCreate={openCreate} />
      ) : (
        <AccountList
          accounts={accounts}
          onEdit={openEdit}
          onArchive={handleArchive}
          onUnarchive={handleUnarchive}
          busy={isPending}
        />
      )}

      <AccountFormDrawer
        open={drawer.open}
        editId={drawer.editId}
        onClose={closeDrawer}
      />
    </>
  );
}
