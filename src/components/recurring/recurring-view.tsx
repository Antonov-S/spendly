"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { DraftsInbox } from "@/components/recurring/drafts-inbox";
import { TemplatesList } from "@/components/recurring/templates-list";
import { TemplateFormDrawer } from "@/components/recurring/template-form-drawer";
import { SuggestionsPanel } from "@/components/recurring/suggestions-panel";
import { RecurringEmptyState } from "@/components/recurring/recurring-empty-state";
import { muteRecurringSuggestion } from "@/actions/recurring";
import type { DraftRow, TemplateRow } from "@/lib/recurring";
import type { RecurringSuggestion } from "@/lib/recurring-suggest";
import type { AccountOption, CategoryOption } from "@/types/transactions";

interface RecurringViewProps {
  templates: TemplateRow[];
  drafts: DraftRow[];
  suggestions: RecurringSuggestion[];
  accounts: AccountOption[];
  categories: CategoryOption[];
}

interface DrawerState {
  open: boolean;
  editId: string | null;
  /** The suggestion that opened the drawer (create mode), if any. */
  prefill: RecurringSuggestion | null;
}

export function RecurringView({
  templates,
  drafts,
  suggestions,
  accounts,
  categories,
}: RecurringViewProps) {
  const [drawer, setDrawer] = useState<DrawerState>({
    open: false,
    editId: null,
    prefill: null,
  });

  const openCreate = () =>
    setDrawer({ open: true, editId: null, prefill: null });
  const openEdit = (id: string) =>
    setDrawer({ open: true, editId: id, prefill: null });
  const openFromSuggestion = (suggestion: RecurringSuggestion) =>
    setDrawer({ open: true, editId: null, prefill: suggestion });
  const closeDrawer = () => setDrawer((d) => ({ ...d, open: false }));

  // Accept path (§9.3): when a suggestion-born template saves, mute its merchant
  // so it stays suppressed even if the user renamed the template before saving.
  const handleCreated = async () => {
    const s = drawer.prefill;
    if (!s) return;
    await muteRecurringSuggestion({
      merchantKey: s.merchantKey,
      outcome: "accepted",
      cadence: s.cadence,
    });
  };

  // The empty state is about the user's OWN templates/drafts. Suggestions render
  // above it regardless — a freshly-imported ledger has zero templates and the
  // strongest suggestions (§9.1).
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

      <SuggestionsPanel suggestions={suggestions} onCreate={openFromSuggestion} />

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
        prefill={drawer.prefill}
        accounts={accounts}
        categories={categories}
        onClose={closeDrawer}
        onCreated={handleCreated}
      />
    </>
  );
}
