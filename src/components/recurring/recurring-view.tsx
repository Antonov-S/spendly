"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { DraftsInbox } from "@/components/recurring/drafts-inbox";
import { TemplatesList } from "@/components/recurring/templates-list";
import { TemplateFormDrawer } from "@/components/recurring/template-form-drawer";
import { RecurringEmptyState } from "@/components/recurring/recurring-empty-state";
import type { DraftRow, TemplateRow } from "@/lib/recurring";
import type { AccountOption, CategoryOption } from "@/types/transactions";

interface RecurringViewProps {
  templates: TemplateRow[];
  drafts: DraftRow[];
  accounts: AccountOption[];
  categories: CategoryOption[];
}

interface DrawerState {
  open: boolean;
  editId: string | null;
}

export function RecurringView({
  templates,
  drafts,
  accounts,
  categories,
}: RecurringViewProps) {
  const [drawer, setDrawer] = useState<DrawerState>({
    open: false,
    editId: null,
  });

  const openCreate = () => setDrawer({ open: true, editId: null });
  const openEdit = (id: string) => setDrawer({ open: true, editId: id });
  const closeDrawer = () => setDrawer((d) => ({ ...d, open: false }));

  const isEmpty = templates.length === 0 && drafts.length === 0;

  return (
    <>
      <header className="flex items-center gap-3">
        <div>
          <h1 className="text-[20px] font-medium leading-none text-ink">
            Recurring
          </h1>
          <p className="mt-1.5 text-[12px] text-ink-3">
            Standing rules that suggest a transaction each period
          </p>
        </div>

        <button
          type="button"
          onClick={openCreate}
          className="ml-auto flex items-center gap-1.5 rounded-lg bg-success px-3 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
        >
          <Plus size={16} />
          <span className="hidden sm:inline">New template</span>
        </button>
      </header>

      {isEmpty ? (
        <RecurringEmptyState onCreate={openCreate} />
      ) : (
        <div className="flex flex-col gap-4">
          {drafts.length > 0 && <DraftsInbox drafts={drafts} />}
          <TemplatesList templates={templates} onEdit={openEdit} />
        </div>
      )}

      <TemplateFormDrawer
        open={drawer.open}
        editId={drawer.editId}
        accounts={accounts}
        categories={categories}
        onClose={closeDrawer}
      />
    </>
  );
}
