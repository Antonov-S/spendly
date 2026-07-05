"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Check,
  Sparkles,
  SplitSquareHorizontal,
  Star,
  X,
} from "lucide-react";
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
import { createFavorite, trackFavoriteUsed } from "@/actions/favorites";
import { suggestCategory } from "@/actions/ai/suggest-category";
import { trackCategoryOutcome } from "@/actions/ai/track-outcome";
import { parseTransaction } from "@/actions/ai/parse-transaction";
import {
  trackParseOutcome,
  type ParsedField,
} from "@/actions/ai/track-parse-outcome";
import { CategoryPickerField } from "@/components/categories/category-picker-field";
import { TagPickerField } from "@/components/tags/tag-picker-field";
import { SplitEditor } from "@/components/transactions/split-editor";
import { TRANSACTION_TYPE_OPTIONS } from "@/lib/constants";
import { BREAKPOINTS, FAVORITE_MAX_COUNT } from "@/lib/system-constants";
import { isSplitBalanced, type SplitDraft } from "@/lib/split";
import { todayDateInputValue } from "@/lib/date";
import { getDefaultActiveAccount } from "@/lib/account";
import { formatCurrencyCents } from "@/lib/format";
import { buildFavoritePrefill } from "@/lib/favorites";
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
  const [isSavingFavorite, startSavingFavorite] = useTransition();

  const [formData, setFormData] = useState<DrawerFormData | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form fields
  const [type, setType] = useState<TransactionTypeValue>("EXPENSE");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayDateInputValue);
  const [categoryId, setCategoryId] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  // Split mode (EXPENSE only). `splits` replaces the single category when on.
  const [isSplit, setIsSplit] = useState(false);
  const [splits, setSplits] = useState<SplitDraft[]>([]);
  const [accountId, setAccountId] = useState("");
  const [fromAccountId, setFromAccountId] = useState("");
  const [toAccountId, setToAccountId] = useState("");
  const [merchant, setMerchant] = useState("");
  const [note, setNote] = useState("");
  const [transferPairId, setTransferPairId] = useState<string | null>(null);
  const amountInputRef = useRef<HTMLInputElement>(null);
  const [favoriteFormOpen, setFavoriteFormOpen] = useState(false);
  const [favoriteName, setFavoriteName] = useState("");
  const [favoriteError, setFavoriteError] = useState<string | null>(null);

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

  // NL Quick Capture (Pro, create-mode). `quickAddText` is the raw line and is
  // retained for the drawer session so the user can tweak-and-re-parse (D7).
  // `draftSnapshot` records the parse-filled field values so Save can report
  // which fields the user edited first (telemetry, §7). All reset on reopen.
  const [isParsing, startParsing] = useTransition();
  const [quickAddText, setQuickAddText] = useState("");
  const [parseNote, setParseNote] = useState<string | null>(null);
  const [parseConfidence, setParseConfidence] = useState<
    "high" | "low" | null
  >(null);
  const [parsePromptVersion, setParsePromptVersion] = useState<number | null>(
    null
  );
  const [draftSnapshot, setDraftSnapshot] = useState<Record<
    ParsedField,
    string
  > | null>(null);
  // Monotonic token (sibling to suggestRunRef): a slow parse resolving after the
  // drawer closed/reopened is discarded rather than landing on a fresh entry.
  const parseRunRef = useRef(0);

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
    // Clear any prior NL Quick Capture state (D7 — local-only, never persisted).
    setQuickAddText("");
    setParseNote(null);
    setParseConfidence(null);
    setParsePromptVersion(null);
    setDraftSnapshot(null);
    // Clear split mode; the edit branch re-hydrates it below when applicable.
    setIsSplit(false);
    setSplits([]);
    setFavoriteFormOpen(false);
    setFavoriteName("");
    setFavoriteError(null);

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
          setTagIds(t.tagIds ?? []);
          if (t.isSplit && t.splits && t.splits.length > 0) {
            setIsSplit(true);
            setSplits(
              t.splits.map((s) => ({
                categoryId: s.categoryId,
                amount: s.amount,
                note: s.note ?? "",
              }))
            );
          }
        }
      });
    } else {
      // Create mode — reset to defaults.
      setType("EXPENSE");
      setAmount("");
      setDate(todayDateInputValue());
      setCategoryId("");
      setTagIds([]);
      setAccountId("");
      setFromAccountId("");
      setToAccountId("");
      setMerchant("");
      setNote("");
      setTransferPairId(null);
    }

    return () => {
      active = false;
      // Invalidate any in-flight suggestion/parse: this drawer session is ending.
      suggestRunRef.current += 1;
      parseRunRef.current += 1;
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
  const tags = formData?.tags ?? [];
  const favorites = formData?.favorites ?? [];
  const noAccounts = formData !== null && accounts.length === 0;
  const busy = isPending || loadingEdit;
  const canSaveCurrentFavorite =
    !isEdit &&
    !isTransfer &&
    (amount.trim().length > 0 ||
      merchant.trim().length > 0 ||
      categoryId.length > 0);
  const favoriteLimitReached = favorites.length >= FAVORITE_MAX_COUNT;

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

  function handleParse() {
    const text = quickAddText.trim();
    if (!text) return; // nothing to parse
    setParseNote(null);
    const myRun = parseRunRef.current;
    startParsing(async () => {
      const res = await parseTransaction({ text });
      // Discard a result whose drawer session has since closed/reopened.
      if (parseRunRef.current !== myRun) return;
      if (!res.success) {
        setParseNote(
          res.reason === "no_match"
            ? "Couldn't read that — add the details manually."
            : res.reason === "rate_limited"
              ? "You've hit the hourly limit — enter it manually."
              : res.error
        );
        return;
      }
      const d = res.data;
      // Pre-fill the form wholesale (D8 — re-parse replaces every parse-owned
      // field). The account is NOT set — it keeps the topbar-scope default (D4).
      setType(d.type);
      setAmount(String(d.amount));
      setDate(d.date);
      setCategoryId(d.categoryId ?? "");
      setMerchant(d.merchant ?? "");
      setNote(d.note ?? "");
      // Snapshot the drafted values so Save can report which fields were edited.
      setDraftSnapshot({
        type: d.type,
        amount: String(d.amount),
        date: d.date,
        category: d.categoryId ?? "",
        merchant: d.merchant ?? "",
        note: d.note ?? "",
      });
      setParseConfidence(d.confidence);
      setParsePromptVersion(d.promptVersion);
    });
  }

  /** Diff the current field values against the parse snapshot for telemetry. */
  function editedParseFields(): ParsedField[] {
    if (!draftSnapshot) return [];
    const edited: ParsedField[] = [];
    if (type !== draftSnapshot.type) edited.push("type");
    if (amount !== draftSnapshot.amount) edited.push("amount");
    if (date !== draftSnapshot.date) edited.push("date");
    if (categoryId !== draftSnapshot.category) edited.push("category");
    if (merchant !== draftSnapshot.merchant) edited.push("merchant");
    if (note !== draftSnapshot.note) edited.push("note");
    return edited;
  }

  // Switching away from EXPENSE clears split mode (splits are EXPENSE-only).
  function handleTypeChange(next: TransactionTypeValue) {
    setType(next);
    if (next !== "EXPENSE" && isSplit) {
      setIsSplit(false);
      setSplits([]);
    }
  }

  // Toggle split mode. Turning on seeds two empty lines (the minimum) and clears
  // the single category; turning off drops the lines and restores the picker.
  function toggleSplit() {
    if (isSplit) {
      setIsSplit(false);
      setSplits([]);
    } else {
      setCategoryId("");
      setSplits([
        { categoryId: "", amount: 0, note: "" },
        { categoryId: "", amount: 0, note: "" },
      ]);
      setIsSplit(true);
    }
  }

  function clearDraftHints() {
    setSuggestedCategoryId(null);
    setSuggestionPromptVersion(null);
    setSuggestionConfidence(null);
    setSuggestedMerchant(null);
    setSuggestNote(null);
    setQuickAddText("");
    setParseNote(null);
    setParseConfidence(null);
    setParsePromptVersion(null);
    setDraftSnapshot(null);
  }

  function handleFavoriteTap(favorite: DrawerFormData["favorites"][number]) {
    const prefill = buildFavoritePrefill(
      favorite,
      {
        categoryIds: new Set(categories.map((c) => c.id)),
        accountIds: new Set(accounts.map((a) => a.id)),
      },
      todayDateInputValue()
    );

    handleTypeChange(prefill.type);
    setAmount(prefill.amount);
    setDate(prefill.date);
    setCategoryId(prefill.categoryId);
    if (prefill.accountId !== null) setAccountId(prefill.accountId);
    setMerchant(prefill.merchant);
    setNote(prefill.note);
    setIsSplit(false);
    setSplits([]);
    clearDraftHints();
    setFavoriteFormOpen(false);
    setFavoriteError(null);
    void trackFavoriteUsed({ hasAmount: favorite.amount !== null });

    if (prefill.focusAmount) {
      requestAnimationFrame(() => amountInputRef.current?.focus());
    }
  }

  function openFavoriteForm() {
    const categoryName = categories.find((c) => c.id === categoryId)?.name;
    setFavoriteName(merchant.trim() || categoryName || "");
    setFavoriteError(null);
    setFavoriteFormOpen(true);
  }

  function appendFavorite(favorite: DrawerFormData["favorites"][number]) {
    setFormData((prev) =>
      prev
        ? {
            ...prev,
            favorites: [...prev.favorites, favorite].sort((a, b) =>
              a.name.localeCompare(b.name)
            ),
          }
        : prev
    );
  }

  function handleSaveFavorite() {
    if (isTransfer) return;
    setFavoriteError(null);
    startSavingFavorite(async () => {
      const res = await createFavorite({
        name: favoriteName,
        type: type === "INCOME" ? "INCOME" : "EXPENSE",
        amount: amount.trim().length > 0 ? Number(amount) : null,
        categoryId: isSplit ? null : categoryId || null,
        financialAccountId: accountId || null,
        merchant: merchant.trim() || null,
        note: note.trim() || null,
      });

      if (res.success) {
        appendFavorite(res.data);
        setFavoriteFormOpen(false);
        setFavoriteName("");
        toast.success("Favorite saved");
      } else {
        setFavoriteError(res.error);
      }
    });
  }

  const splitReady = !isSplit || isSplitBalanced(Number(amount), splits);

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
          // Split mode and a single category are mutually exclusive (server-enforced).
          categoryId: isSplit ? null : categoryId || null,
          tagIds,
          splits: isSplit
            ? splits.map((s) => ({
                categoryId: s.categoryId,
                amount: s.amount,
                note: s.note.trim() || null,
              }))
            : [],
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
        // Telemetry: was this parse-originated entry confirmed, and which
        // drafted fields were edited first? Field NAMES only, never values (§7).
        if (!isTransfer && parsePromptVersion !== null) {
          void trackParseOutcome({
            confirmed: true,
            editedFields: editedParseFields(),
            promptVersion: parsePromptVersion,
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
          {/* Quick add (NL Quick Capture) — Pro, create-mode only. Parses one
              line into a draft for the user to confirm; never saves (D1/D6). */}
          {!isEdit && isPro && (
            <div className="mb-5 rounded-lg border border-ai/30 bg-ai/5 p-3">
              <div className="mb-1.5 flex items-center gap-1 text-[11px] font-medium text-ai">
                <Sparkles className="size-3.5" />
                Quick add
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={quickAddText}
                  onChange={(e) => setQuickAddText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleParse();
                    }
                  }}
                  // Autofocus the capture line on desktop create-open (D10); the
                  // field only renders in create + Pro, so gating on isDesktop is
                  // enough. Suppressed on mobile to avoid a keyboard takeover.
                  autoFocus={isDesktop}
                  placeholder="e.g. 12 lunch at Pret yesterday"
                  className="w-full rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3"
                />
                <button
                  type="button"
                  onClick={handleParse}
                  disabled={isParsing || quickAddText.trim().length === 0}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-ai/30 bg-ai/10 px-2.5 py-2 text-[12px] font-medium text-ai transition-colors hover:bg-ai/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Sparkles className="size-3.5" />
                  {isParsing ? "Reading…" : "Parse"}
                </button>
              </div>
              {parseConfidence !== null && parseConfidence !== "high" && (
                <p className="mt-1.5 text-[11px] text-ai">
                  AI draft — double-check the details.
                </p>
              )}
              {parseNote && (
                <p className="mt-1.5 text-[11px] text-ink-3">{parseNote}</p>
              )}
            </div>
          )}

          {!isEdit &&
            (favorites.length > 0 ||
              canSaveCurrentFavorite ||
              favoriteLimitReached) && (
              <div className="mb-4 space-y-2">
                {canSaveCurrentFavorite &&
                  !favoriteLimitReached &&
                  !favoriteFormOpen && (
                    <button
                      type="button"
                      onClick={openFavoriteForm}
                      className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-line bg-surface-2 px-3 text-[13px] font-medium text-ink-2 transition-colors hover:border-ink-3 hover:text-ink"
                    >
                      <Star className="size-3.5" />
                      Save as favorite
                    </button>
                  )}
                {/* Grid, not a scroll row: horizontal scrolling on a touch
                    sheet turns scroll attempts into accidental chip taps (and
                    a chip tap overwrites the whole form). Two lines per cell —
                    name above, amount below — so the name always gets the full
                    cell width and never truncates against the amount. Fixed 2
                    columns: the drawer is 420px even on desktop, and a third
                    column can't fit name + amount readably. */}
                {favorites.length > 0 && (
                  <div className="grid grid-cols-2 gap-2">
                    {favorites.map((favorite) => (
                      <button
                        key={favorite.id}
                        type="button"
                        onClick={() => handleFavoriteTap(favorite)}
                        aria-label={`Use ${favorite.name} favorite`}
                        className="flex min-w-0 flex-col items-start gap-0.5 rounded-md border border-line bg-surface-2 px-2.5 py-2 text-left transition-colors hover:border-ink-3"
                      >
                        <span className="flex w-full min-w-0 items-center gap-1.5 text-[12px] font-medium text-ink">
                          <Star className="size-3.5 shrink-0 text-ink-3" />
                          <span className="truncate">{favorite.name}</span>
                        </span>
                        {favorite.amount !== null && (
                          <span className="pl-5 text-[11px] text-ink-3">
                            {formatCurrencyCents(favorite.amount)}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
                {canSaveCurrentFavorite && favoriteLimitReached && (
                  <p className="text-[11px] text-ink-3">
                    Remove one in Settings to save another favorite.
                  </p>
                )}
                {favoriteFormOpen && (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={favoriteName}
                      onChange={(e) => setFavoriteName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleSaveFavorite();
                        }
                        if (e.key === "Escape") {
                          setFavoriteFormOpen(false);
                          setFavoriteError(null);
                        }
                      }}
                      placeholder="Favorite name"
                      aria-label="Favorite name"
                      className="min-w-0 flex-1 rounded-lg border border-line bg-app px-3 py-2 text-[13px] text-ink outline-none placeholder:text-ink-3"
                    />
                    <button
                      type="button"
                      onClick={handleSaveFavorite}
                      disabled={isSavingFavorite}
                      aria-label="Save favorite"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-success text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                    >
                      <Check size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setFavoriteFormOpen(false);
                        setFavoriteError(null);
                      }}
                      aria-label="Cancel favorite"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
                    >
                      <X size={15} />
                    </button>
                  </div>
                )}
                {favoriteError && (
                  <p className="text-[11px] text-danger">{favoriteError}</p>
                )}
              </div>
            )}

          {/* Type toggle */}
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-line bg-app p-1">
            {TRANSACTION_TYPE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleTypeChange(option.value)}
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
                ref={amountInputRef}
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
                <div className="flex items-center gap-1">
                  {/* Split toggle — expenses only. A neutral bordered chip:
                      differentiated from the grey label by full-contrast text +
                      border + icon, NOT by a hue (blue is reserved for AI
                      affordances, green for "+ New category"). */}
                  {type === "EXPENSE" && (
                    <button
                      type="button"
                      onClick={toggleSplit}
                      aria-pressed={isSplit}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium text-ink transition-colors",
                        isSplit
                          ? "border-ink-3 bg-ink/10"
                          : "border-line bg-surface-2 hover:border-ink-3"
                      )}
                    >
                      <SplitSquareHorizontal className="size-3.5" />
                      {isSplit ? "Splitting · tap to undo" : "Split expense"}
                    </button>
                  )}
                  {/* AI Suggest — Pro, hidden in split mode (no single category). */}
                  {!isSplit && isPro && (
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
                  )}
                </div>
              }
            >
              {isSplit ? (
                <SplitEditor
                  categories={categories}
                  total={Number(amount) || 0}
                  splits={splits}
                  onChange={setSplits}
                />
              ) : (
                <>
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
                </>
              )}
            </Field>
          )}

          {/* Tags — hidden for transfers (v1). Free-form labels orthogonal to category. */}
          {!isTransfer && (
            <Field label="Tags" optional>
              <TagPickerField
                tags={tags}
                value={tagIds}
                onChange={setTagIds}
              />
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
            disabled={busy || noAccounts || !splitReady}
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
      {/* Margin lives on the row (not the label) so the body clears a taller
          action control — e.g. the bordered Split toggle — without overlapping. */}
      <div className="mb-1.5 flex min-h-6 items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-ink-2">
          {label}
          {optional && (
            <span className="ml-1 font-normal text-ink-3">(optional)</span>
          )}
        </span>
        {action}
      </div>
      {children}
    </div>
  );
}
