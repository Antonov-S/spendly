# Quick-Add Favorites — Implementation Spec

> **Goal:** Saved one-tap common transactions — *"Coffee €3.50 / Dining"* — that **pre-fill the
> transaction drawer as an unsaved draft** the user confirms through the existing
> `createTransaction`. On-demand capture shortcuts serving the 5-second-capture goal — distinct
> from recurring templates (which are *scheduled*); favorites are *whenever-it-happens*.

Implements [POST-MVP-ROADMAP.md](../POST-MVP-ROADMAP.md) **§19 Quick-Add Favorites** (Delivery
Sequence **slot 15** — the next unshipped slot; slots 1–14 are all shipped). Branch:
`feature/quick-add-favorites`. Follows the patterns in
[entity-crud-architecture.md](./entity-crud-architecture.md); the prefill-never-write contract
mirrors [nl-quick-capture-spec.md](./nl-quick-capture-spec.md) and
[subscription-detection-spec.md](./subscription-detection-spec.md); the small user-owned-store
CRUD mirrors [transaction-tags-spec.md](./transaction-tags-spec.md).

---

## 0. Sequencing notes — read before building

- **Zero AI.** No `runAiFeature`, no prompt, no `--color-ai` accent. A favorite is a stored
  snapshot the user created deliberately — deterministic by construction. If the diff imports
  anything from `src/lib/ai/`, the slice is off-spec.
- **The Pro Value Review checkpoint does not block this slice.** It gates §13 (AI expansion);
  §19 is a non-AI enhancement and proceeds independently — the same reasoning §9, §10, and §18
  recorded.
- **`createTransaction` stays the sole writer.** Tapping a favorite fills drawer state — it
  never saves. The user still confirms every entry (amount visible, account visible, one Save).
  This is the confirm-not-auto contract that governs every prefill surface in the app (NL
  parse, subscription suggestions, recurring drafts).
- **On-thesis check.** The core thesis is *conscious capture in under 5 seconds for a
  previously-used category*. A favorite is the purest realization of that sentence: the user
  pre-decided the shape of a repeated expense once, and each use is a deliberate tap + confirm.
  Nothing is inferred, scheduled, or silent.

---

## 1. Why this slice

The 5-second target is currently met only for Pro users via NL Quick Capture (type a line, get
a draft). Free users — and Pro users with truly repetitive entries — still walk the full field
list for the fifth coffee this week. Recurring templates don't fit: they are *scheduled*
(cadence + drafts), and an on-demand coffee has no schedule.

A favorite closes the gap with zero marginal cost: one tap loads type / amount / category /
account / merchant / note; the user glances, adjusts if needed, saves. The capture moment stays
conscious (the drawer is open, the Save is explicit) but the typing burden drops to ~zero.

---

## 2. Scope

### In scope

- A new additive **`Favorite` model** — the user's saved capture shortcuts (§3).
- **CRUD actions** (`src/actions/favorites.ts`): `createFavorite`, full-field `updateFavorite`,
  `reorderFavorites`, `deleteFavorite` — plus a `getUserFavorites` fetcher (§6–§7).
- **Favorites strip in the transaction drawer, create mode only**: a two-column chip grid that
  pre-fills the form wholesale on tap — the fill values computed by a **pure, directly-tested
  helper** `buildFavoritePrefill` (`src/lib/favorites.ts`), since components are out of Vitest
  scope but the prefill rules are the core UX contract (§8.1).
- **"Save as favorite" affordance in the drawer, create mode only**: snapshots the currently
  filled fields into a new favorite with a one-line name input (§8.2).
- A **"Favorites" management card on `/settings`** (edit + reorder + delete), after Tags (§8.3).
- Constants `FAVORITE_NAME_MAX` / `FAVORITE_MAX_COUNT` (§5); validation schemas (§4).
- Vitest coverage for validations, actions, and the DB fetcher (§11).

### Out of scope (explicit)

- **No Pro gate** (D1). Deterministic, zero COGS, and it serves the *core* capture promise —
  the same stance as §10/§18: Pro depth is the AI layer + Reports history, not fast entry.
- **No TRANSFER favorites** (D2). Income/expense only — same rule as recurring templates and
  tags. A transfer is not a "coffee-shaped" repeated capture.
- **No splits, no tags on favorites** (v1). A favorite carries a single optional category;
  the split editor and tag picker remain manual post-fill steps. Deferred, not rejected — the
  extension contracts are written down in §10 so a later slice stays additive.
- **No usage tracking / MRU ordering.** v1 shipped name-ascending and deterministic (D6);
  `favorites-follow-ups-spec.md` ships the committed manual ordering seam as accessible
  move controls backed by nullable `sortOrder`. MRU stays rejected (a usage write on the
  capture hot path, and chips that jump under the user's finger).
- **No dedicated quick-add bar outside the drawer.** The NL spec already ruled that out;
  favorites live inside the drawer's create mode, same surface, same reasoning.
- **No export/import of favorites** (v1). Same deliberate scope call as tags — favorites are
  device-light preferences, not ledger data. Documented seam, not a gap.
- **No account scoping.** The strip shows all favorites regardless of `?account=`; a
  favorite's own stored account (when present and active) wins at prefill time (§8.1).

---

## 3. Data model (Prisma — additive migration `add_favorites`)

```prisma
// ─── Favorite ─────────────────────────────────────────
// A saved capture shortcut: pre-fills the transaction drawer as an unsaved
// draft. NEVER creates transactions itself — createTransaction is the sole
// writer. INCOME/EXPENSE only (no transfers). Every field except name/type is
// optional: a null amount means "prompt on use" (drawer focuses the amount).

model Favorite {
  id        String          @id @default(cuid())
  name      String          // chip label, e.g. "Coffee"
  type      TransactionType // INCOME | EXPENSE (TRANSFER rejected in validation)
  amount    Decimal?        @db.Decimal(12, 2) // null = prompt-on-use
  merchant  String?
  note      String?
  createdAt DateTime        @default(now())
  updatedAt DateTime        @updatedAt

  userId             String
  categoryId         String?
  financialAccountId String?

  user             User              @relation(fields: [userId], references: [id], onDelete: Cascade)
  category         Category?         @relation(fields: [categoryId], references: [id], onDelete: SetNull)
  financialAccount FinancialAccount? @relation(fields: [financialAccountId], references: [id], onDelete: SetNull)

  @@unique([name, userId])
  @@index([userId])
}
```

- **No existing table changes.** `User`, `Category`, and `FinancialAccount` gain only the
  back-relation lists Prisma requires.
- **`SetNull` on both FKs**: deleting a custom category degrades the favorite to
  "Uncategorized at fill time" rather than killing it; the same for an account (the drawer's
  default account takes over, §8.1). This matches the app-wide "referenced entity vanishes →
  the dependent survives degraded" stance (transactions' `categoryId`).
- **Case-insensitive name dedup, three layers** — mirroring tags exactly: app-level pre-check
  in the action, a functional `(lower(name), userId)` unique index via a second `--create-only`
  migration (`favorite_name_ci_unique`), and a `P2002` catch mapping to a friendly message.
- **Currency is not stored.** It is stamped from the account by `createTransaction` at save
  time, as always — a favorite is drawer state, not ledger data.

---

## 4. Validation (`src/lib/validations/favorite.ts`)

```ts
createFavoriteSchema = z.object({
  name:               z.string().trim().min(1).max(FAVORITE_NAME_MAX),
  type:               z.enum(["INCOME", "EXPENSE"]),   // no TRANSFER — same as templates
  amount:             /* the transaction `amount` rule (coerce, finite, > 0) */ .nullish(),
  categoryId:         z.string().nullish(),
  financialAccountId: z.string().nullish(),
  merchant:           optionalText(MERCHANT_MAX),
  note:               optionalText(NOTE_MAX),
});

updateFavoriteSchema = z.object({ name: /* same rule */ });   // rename only (D5)
```

- The `amount` rule is the **same positive-finite rule** `createTransactionSchema` uses —
  a favorite must never be able to store an amount the drawer would then reject.
- `merchant`/`note` reuse the single-sourced `MERCHANT_MAX` / `NOTE_MAX` caps so a
  drawer-snapshot round-trip (§8.2) can never fail on length.

---

## 5. Constants (`src/lib/system-constants.ts`)

```ts
/* ── Quick-add favorites (quick-add-favorites spec §5) ── */

/** Max length of a favorite's chip label. */
export const FAVORITE_NAME_MAX = 32;

/** Per-user cap — the strip must stay a glanceable row, not a second feed. */
export const FAVORITE_MAX_COUNT = 12;
```

`FAVORITE_NAME_MAX` matches `TAG_NAME_MAX` (both are short user labels). The count cap is a
product decision, not a technical one: past ~a dozen chips the strip stops being one-glance
and the user is better served by NL capture or templates. Enforced server-side in
`createFavorite` (count check inside the action) and mirrored client-side (the save affordance
hides at cap, with a "remove one on /settings" hint).

---

## 6. DB layer (`src/lib/db/favorites.ts`, `server-only`)

```ts
export async function getUserFavorites(userId: string): Promise<FavoriteOption[]>
```

- Select-only projection, `userId`-scoped, ordered `name asc` (deterministic, D6).
  **Both fetchers share one module-level ordering constant** (`FAVORITE_ORDER_BY`) passed to
  each `orderBy` — the drawer strip and the `/settings` list must be provably incapable of
  diverging, and the future manual-reorder slice (§10) then changes the order in exactly one
  place.
- Maps `Decimal` → `number | null` at the boundary (no `Decimal` crosses to the client —
  house invariant). **Unit contract, stated once:** `Favorite.amount` is a **major-unit euro
  decimal** end-to-end — `Decimal(12,2)` `3.50` in the DB → `number` `3.5` on the client →
  `String(3.5)` into the drawer's amount field. There is **no cents-integer representation
  anywhere** in this slice and therefore no ×100/÷100 conversion at any boundary.
- `FavoriteOption` (in `src/types/favorites.ts`, serializable):

```ts
export interface FavoriteOption {
  id: string;
  name: string;
  type: "INCOME" | "EXPENSE";
  amount: number | null;            // null = prompt-on-use
  categoryId: string | null;
  financialAccountId: string | null;
  merchant: string | null;
  note: string | null;
}
```

**`/settings` needs its own richer projection** (the `getUserTags` / `getManageableTags`
split, for the same reason):

```ts
export async function getManageableFavorites(userId: string): Promise<ManageableFavorite[]>
```

`ManageableFavorite` extends the option shape with the joined display data the summary line
and the **degraded-shortcut indicator** need:

```ts
export interface ManageableFavorite extends FavoriteOption {
  categoryName: string | null;      // joined; null = uncategorized
  accountName: string | null;       // joined; null = no stored account
  /** True when the stored account exists but is archived — the one *detectable*
   *  degradation (§9): prefill will silently fall back to the default account. */
  accountArchived: boolean;
}
```

No `_count` projection is needed (a favorite has no linked records — deleting one touches
nothing else, unlike categories/tags).

---

## 7. Actions (`src/actions/favorites.ts`, `"use server"`)

All auth-guarded (`auth()` → `session.user.id`), Zod-`safeParse`d, ownership-scoped
`where: { id, userId }`, returning the house `{ success, data?, error? }` shape.

- **`createFavorite(input)`** —
  1. cap check: `favorite.count({ where: { userId } }) >= FAVORITE_MAX_COUNT` → friendly error;
  2. case-insensitive name pre-check (own favorites only — there is no system tier);
  3. referenced `categoryId` must be **visible** to the user (own or system — the same rule
     `createTransaction` applies), else reject;
  4. referenced `financialAccountId` must be **owned and not archived**, else reject
     (archived accounts can't receive transactions, so a shortcut pointing at one is dead
     weight from birth);
  5. `create` inside a `P2002` catch → "You already have a favorite with this name."
  6. Returns the persisted `FavoriteOption` so the drawer can append it to local state
     without a refetch (the `createTag`/`createCategory` auto-select pattern).
- **`updateFavorite(id, input)`** — rename only (D5); same dedup layers.
- **`deleteFavorite(id)`** — hard delete, confirm-gated in the UI (native `<dialog>`, the
  tags/categories pattern). No undo — the favorite is trivially re-creatable from the drawer
  and deleting it touches zero ledger data (state that in the confirm copy).
- **Revalidation:** mutations call `revalidatePath("/settings")` only. The drawer needs
  nothing — it fetches fresh via `getDrawerFormData` on every open (§8), so a new favorite
  appears on the next drawer open with zero extra wiring.

---

## 8. UI

### 8.1 Favorites strip (`transaction-drawer.tsx`, create mode only)

- **Data:** `DrawerFormData` gains `favorites: FavoriteOption[]`; `getDrawerFormData` adds
  `getUserFavorites` to its existing `Promise.all` (the `isPro` threading precedent).
- **Placement:** directly **above the type toggle** (below the Pro Quick-add box when that
  renders) — the first thing a repeat-capture user reaches for. Renders **nothing when the
  user has no favorites** (never UI without backing function — no empty-state nudge inside
  the drawer).
- **Layout (realized — revised during build QA, supersedes the horizontal-scroll row this
  spec originally called for):** a **fixed 2-column grid** (`grid grid-cols-2 gap-2`) of
  equal-width two-line cells, on every breakpoint. Two browser-pass findings forced this:
  **(1)** a horizontal `overflow-x-auto` chip row on the mobile bottom sheet turned scroll
  attempts into accidental chip taps — and a chip tap wholesale-overwrites the form; a grid
  has no scroll gesture to mis-fire. **(2)** an interim 3-column variant crushed names to 2–3
  characters, because the fixed-width amount — not the name — is what consumes an inline
  cell; the drawer is a fixed 420px panel even on desktop, so 3 columns never has honest
  room for name + amount.
- **Chip (realized):** a **two-line cell** — line 1 is star icon + name with the *full cell
  width* to itself (`truncate` only at the cell edge); line 2 is the amount in smaller muted
  text (`€3.50` via `formatCurrencyCents`), indented under the name and **omitted for
  prompt-on-use (null-amount) favorites**, which render single-line. Stacking the amount is
  what guarantees the name never truncates against it. **Formatter note (avoid the name
  trap):** `formatCurrencyCents` takes a **major-unit** amount and formats it *to the cent* —
  `formatCurrencyCents(3.5)` → `"€3.50"` (verified in `src/lib/format.ts`; the split editor
  calls it the same way). Pass the favorite's `amount` as-is — converting to a cents integer
  first would render `€350.00`, and dividing by 100 would render `€0.04`. `formatCurrency` is
  wrong here for the split-spec reason: it drops decimals, so `€3.50` would read `€4`.
  Neutral `bg-surface-2`/`border-line` styling — **not** `--color-ai` (deterministic, not AI)
  and not success-green (Save owns that).
- **Tap = wholesale prefill** (the NL-parse D8 precedent — replace, don't merge), computed by
  a **pure helper** rather than inline component logic:

  ```ts
  // src/lib/favorites.ts — pure, no I/O; the directly-testable core UX contract (§11).
  export interface FavoritePrefill {
    type: "INCOME" | "EXPENSE";
    amount: string;               // String(favorite.amount), or "" when null
    focusAmount: boolean;         // true ⇔ favorite.amount is null (prompt-on-use)
    date: string;                 // caller passes todayDateInputValue()
    categoryId: string;           // "" when unset or not in the loaded list
    accountId: string | null;     // null = leave the drawer's current selection untouched
    merchant: string;
    note: string;
  }

  export function buildFavoritePrefill(
    favorite: FavoriteOption,
    loaded: { categoryIds: ReadonlySet<string>; accountIds: ReadonlySet<string> },
    today: string,
  ): FavoritePrefill
  ```

  The helper owns every **resolution rule** (stale category → `""`, unresolvable account →
  `null`, null amount → empty string + focus flag, date → today); the component merely applies
  the returned patch and keeps its **imperative session resets** (split mode off + lines
  cleared, AI suggestion/parse hint state cleared, the actual `focus()` call) — state the
  helper can't and shouldn't reach. Field semantics:
  - `type` ← favorite's type (via the existing `handleTypeChange`, which already clears
    split mode on a type change);
  - `amount` ← `String(favorite.amount)` when set; **cleared + focused** when null
    (prompt-on-use, D4 — the one field a null-amount favorite deliberately asks for);
  - `date` ← **today** (favorites are "this just happened" shortcuts — never a stored date);
  - `categoryId` ← favorite's category **if it still exists in the loaded `categories`
    list**, else `""` (Uncategorized) — a `SetNull`ed or stale reference degrades silently;
  - `accountId` ← favorite's account **if present in the loaded `accounts` list** (that list
    is already active-only), else **left untouched** (the topbar-scope default stays — the
    NL-capture D4 stance: never fight the user's account context without a reason);
  - `merchant` / `note` ← favorite's values (or `""`);
  - split mode off, splits cleared; `tagIds` untouched; every AI suggestion/parse hint state
    cleared (the tap starts a fresh entry).
- The tap fires `favorite_used` telemetry (fire-and-forget, §9). No snapshot-diff machinery —
  unlike the AI parse there is no acceptance question to measure per-field.

### 8.2 "Save as favorite" affordance (create mode only)

- **(Realized — revised during build QA, supersedes the trailing-chip placement this spec
  originally called for):** a quiet **full-width outline button above the chip grid** —
  `☆ Save as favorite`, `border-line bg-surface-2 text-ink-2` weight. It sits outside the
  grid so it can never be displaced by chips, and it is deliberately **not** `bg-success`:
  an early full-width green variant was rejected because it impersonated the footer's "Save
  transaction" CTA — two same-weight green "Save …" buttons in one drawer invited mis-taps in
  the exact 5-second flow this feature serves ("visual weight serves information"). Rendered
  when the form has something worth saving — `!isTransfer && (amount || merchant.trim() ||
  categoryId)` — and hidden at `FAVORITE_MAX_COUNT` (a hint line "Remove one in Settings to
  save another favorite." shows instead). The inline name input carries
  `aria-label="Favorite name"` (placeholder alone is not an accessible name).
- Tap → an inline one-line name input (defaulting to the trimmed merchant, else the selected
  category's name, else empty) + confirm. Confirm calls `createFavorite` with a **snapshot of
  the current fields** (type, amount or null when blank, categoryId or null, accountId,
  merchant, note; split mode → `categoryId: null` and no split lines — a favorite is
  single-category, §2). On success: append to local strip state (the returned
  `FavoriteOption`), toast `Favorite saved`.
- This is the whole creation UX. There is **no** create-form on `/settings` (D3): the drawer
  *is* the natural authoring moment — you just typed the thing; naming it is one more field.
  `/settings` manages what exists.

### 8.3 `/settings` management card (`src/components/favorites/manage-favorites.tsx`)

- A "Favorites" card **after Tags** (the small-store management row: Categories → Tags →
  Favorites). Each row: name, a compact summary line (`Expense · €3.50 · Dining · Cash` —
  omit null parts, names from the `ManageableFavorite` joins), rename (inline or tiny drawer,
  matching the tags pattern) and delete (confirm `<dialog>`; copy: "Removes the shortcut only
  — no transactions are affected.").
- **Degraded-shortcut indicator:** when `accountArchived` is true, the row shows a quiet
  `warning`-toned chip — `Account archived · uses your default` — so the user can repair the
  shortcut (delete + re-save, or unarchive the account) instead of discovering the silent
  fallback mid-capture. Semantic color rule holds: `warning` amber, not danger — nothing is
  broken, the prefill degrades gracefully; the chip is informational, with no dedicated action
  in v1 (repair = the existing delete/re-save or unarchive paths). This is the only detectable
  degradation — see §9 for why a deleted category can't be flagged.
- Empty state: one line — "Save a favorite from the transaction drawer to see it here." —
  pointing at the real creation surface rather than duplicating it.
- Page wiring: `getManageableFavorites` joins the `/settings` `Promise.all`.

### 8.4 Existing-code touch: category-delete impact copy

The confirm dialog in `manage-categories` / `confirm-delete-dialog.tsx` states the FK impact
of deleting a custom category (transactions/templates → Uncategorized, budgets deleted, split
lines → Uncategorized). It gains one clause: **favorites using this category fall back to
Uncategorized**. This is the mitigation for the §9 indistinguishability — the moment of
category deletion is the only point where "this favorite is about to degrade" is knowable, so
the warning lives there, not in the favorites list. (Copy-only change; no new query — parity
with how split lines were added to this dialog.)

---

## 9. Edge cases & rules

- **Favorite references a deleted category** → FK is already `SetNull`; prefill falls back to
  Uncategorized. The `/settings` summary line simply omits the category. **Honest limitation:**
  after `SetNull`, a degraded favorite is *indistinguishable* from one deliberately saved
  without a category — the information is erased at delete time, so no "repair me" chip is
  possible for the category side (flagging every uncategorized favorite would be noise, not
  signal). Mitigation lives at the cause instead: the category-delete confirm dialog names the
  impact (§8.4). Snapshotting the category *name* on the favorite to preserve the distinction
  was considered and rejected — a denormalized copy that goes stale on rename for the sake of
  a warning chip.
- **Favorite references an archived account** → the account is absent from the drawer's
  active-only list, so prefill leaves the current default; the favorite is *not* auto-pruned
  (unarchiving restores it). Creation-time is the only hard gate (§7). Unlike the category
  case this **is** detectable (archiving preserves the row), so `/settings` flags it (§8.3).
- **Cap reached** → server rejects with a friendly message; the drawer affordance is hidden
  before that point anyway.
- **Duplicate name (any case)** → rejected at all three layers, same message shape as tags.
- **Zero favorites** → the drawer shows only the save affordance (when the form has content);
  `/settings` shows the pointer line. No other surface changes.
- **EUR-only** — nothing to do; amount is a bare number, currency stamped at save time (§3).
- **Telemetry** — through the no-op `track()` shim, counts/enums only, no names or amounts
  (the shim's no-PII contract): `favorite_created { favoriteCount }`,
  `favorite_used { hasAmount }`, `favorite_deleted { favoriteCount }`. Light by design — the
  §0 question this answers is "do favorites earn strip real estate," nothing per-field.

---

## 10. Decisions (resolving the roadmap's open questions)

| # | Decision | Rationale |
|---|---|---|
| **D1** | **Free, not Pro-gated** (resolves open question #10's remaining half) | Deterministic, zero COGS, and it serves the *core* 5-second-capture promise for the users who don't have NL Quick Capture. Pro depth stays AI + Reports history (the §10/§18 stance). |
| **D2** | **Pre-fill draft, never one-tap create** | The roadmap's own recommendation, and the app-wide confirm contract: recurring drafts, NL parse, and subscription suggestions all pre-fill; `createTransaction` is the sole writer. One-tap-create would be the first silent write path in the product. |
| **D3** | **Authoring in the drawer; management on `/settings`** | The drawer is where the fields are already filled — "save what I just typed" beats re-entering it in a settings form. `/settings` gets edit, reorder, and delete. |
| **D4** | **`amount` optional — fixed when set, prompt-on-use when null** | Resolves "fixed amount vs. prompt-on-use" with *both*, cheaply: null amount → the drawer clears + focuses the amount field. "Coffee €3.50" and "Groceries (varies)" are both real favorites. |
| **D5** | **Full field editing on `/settings` shipped as the committed first follow-up** | Field edits no longer require delete + re-save. `favorites-follow-ups-spec.md` widens update to the create field set and adds the repair path for archived-account favorites. |
| **D6** | **Manual ordering shipped; MRU rejected** | `favorites-follow-ups-spec.md` adds stable user-controlled ordering with accessible move controls and nullable `sortOrder`. MRU remains rejected: a usage write on the capture hot path and chips that jump under the user's finger defeat muscle memory. |
| **D7** | **Prefill is wholesale, date always today, account only when resolvable** | Mirrors the NL-parse semantics the drawer already implements (replace parse-owned fields; never fight the account context) — one mental model for every prefill source. |

### Rejected (considered, decided against — with the seam named)

- **Extending `RecurringTemplate` with a "no cadence" mode** instead of a new model. Tempting
  reuse, but it poisons every template consumer (draft generation, forecast, suggestion
  suppression) with a null-cadence branch. Favorites and templates answer different questions
  (*on-demand* vs. *scheduled*); separate small models keep both simple. **Seam:** a future
  "promote favorite → template" action is a one-way copy, trivially added.
- **Favorites in the mobile bottom-nav long-press / a home-strip.** Real value on mobile, but
  it belongs to the parked Mobile/PWA theme (§14) — the drawer strip is the v1 surface
  everywhere; the chip component is reusable when §14 lands.
- **Storing `tagIds` on favorites.** Requires a join table or array column plus staleness
  handling for deleted tags, for a secondary field. Deferred until tags prove central to
  repeat captures.

### Deferred (known follow-ups, not oversights — each with its seam named)

- **Full field editing on `/settings`** (D5) — **shipped in
  `favorites-follow-ups-spec.md`**. `updateFavoriteSchema` now aliases the full
  `createFavoriteSchema`, and the Settings edit drawer reuses `<CategoryPickerField>` plus an
  active-account select. This also makes archived-account favorite warnings repairable.
- **Manual reordering on `/settings`** (D6) — **shipped in
  `favorites-follow-ups-spec.md`** as accessible move controls rather than drag-and-drop. The
  additive `sortOrder Int?` column orders rows before name fallback, and both favorite fetchers
  still share `FAVORITE_ORDER_BY` so the drawer strip and `/settings` list cannot diverge.
- **"Save this as a favorite?" post-save suggestion** for transactions the user keeps
  re-typing. Explicitly **deterministic and user-controlled** — the §10-subscription-detection
  shape, never AI: a pure engine counts recent captures by `(normalizeLabelKey(merchant),
  type)` (reusing `src/lib/text.ts`), fires only past a strict threshold (e.g. ≥ 3 in 30 days,
  constants like `SUBSCRIPTION_*`), suppresses merchants that already match an existing
  favorite *or* template, and renders as a quiet dismissible line under the save toast — with
  dismissals persisted via a mute model mirroring `RecurringSuggestionMute` (a false nudge has
  no resolution path otherwise; same justification as §10's mute table). Nothing auto-creates;
  accept opens the §8.2 name input pre-filled. Held out of v1 because it needs its own
  precision tuning + telemetry to prove it isn't nagging — the roadmap's calm-not-nagging bar.
- **Export/import of favorites** (device-migration nicety; same deliberate scope call as tags).
- **"Promote favorite → recurring template"** cross-action (one-way copy into the template
  drawer, unsaved — the §3 rejected-alternative seam).

### Extension contracts — Tags & Splits on favorites (documented now, built later)

Written down so a future slice extends rather than reinterprets (both features are already
shipped; the interaction is deliberately *not* implicit):

- **Tags:** a `FavoriteTag` join mirroring `TransactionTag` (composite PK, cascade both ways —
  deleting a tag silently drops it from favorites, matching how tag deletion already treats
  transactions). Prefill sets `tagIds` to the favorite's tags **filtered to the loaded `tags`
  list** (stale ids drop silently, the §8.1 degradation rule). Cap shared with
  `TAG_MAX_PER_TRANSACTION` so a favorite can never pre-fill an unsaveable form.
- **Splits:** a `FavoriteSplit` child mirroring `TransactionSplit` (`amount`, `note?`,
  `categoryId?` SetNull), **allowed only on fixed-amount EXPENSE favorites** — a prompt-on-use
  (null-amount) favorite cannot carry fixed split lines that must sum to an unknown total, and
  proportional splits would be a new concept the transaction model doesn't have. Same
  sum-to-the-cent validation as `createTransactionSchema`; prefill enters split mode and seeds
  `SplitEditor` (a `SetNull`ed line degrades to Uncategorized, keeping the sum intact — the
  save gate stays satisfiable). Mutually exclusive with a top-level `categoryId`, exactly as on
  transactions.
- Both are additive migrations + a wider snapshot in §8.2; neither changes the prefill
  contract (wholesale fill, `createTransaction` sole writer) or any aggregation —
  favorites never touch `getCategorySpend` because they are not ledger data.

---

## 11. Testing (Vitest — actions + lib per standards; components out of scope)

- **`test/lib/favorites.test.ts`** — the prefill contract, tested directly (components are
  out of Vitest scope, so this pure helper is where the core UX contract gets its coverage):
  fixed amount → `amount: "3.5"`-style string + `focusAmount: false`; null amount → `""` +
  `focusAmount: true`; category present in `categoryIds` → kept, absent/null → `""`;
  account present in `accountIds` → set, absent/null → `accountId: null` (leave-untouched
  signal); `date` echoes the injected `today`; merchant/note null → `""`; determinism
  (same input twice → deep-equal output); output is a complete patch (every field present —
  wholesale, never partial).
- **`test/lib/validations/favorite.test.ts`** — name trim/length bounds; TRANSFER rejected;
  amount nullish vs. positive-finite rule (mirrors the transaction rule); merchant/note caps.
- **`test/actions/favorites.test.ts`** — auth guards; cap enforcement at
  `FAVORITE_MAX_COUNT`; case-insensitive dedup pre-check + `P2002` mapping; system category
  accepted / foreign category rejected; archived or foreign account rejected; ownership on
  update/delete (`where: { id, userId }`); `revalidatePath("/settings")` called (and no
  transaction-view paths); create returns the serializable `FavoriteOption`.
- **`test/lib/db/favorites.test.ts`** — where-shape (`userId` scoping), `name asc` ordering,
  `Decimal → number | null` mapping; `getManageableFavorites` join projection
  (category/account name mapping, `accountArchived` derived true only when an account is
  present *and* archived — absent account → `false`, not degraded).

`npm run test:run` and `npm run build` must pass before commit.

---

## 12. Implementation order

1. Schema + migrations: `add_favorites` (plain) then `favorite_name_ci_unique`
   (`--create-only`, hand-edited — the `tag_name_ci_unique` template). Apply to the
   `development` Neon branch via `prisma migrate dev`; `prisma migrate status` clean.
2. Constants (§5), types (§6), validation schemas + suite (§4).
3. `src/lib/favorites.ts` (`buildFavoritePrefill`) + suite (TDD-friendly, zero I/O — the
   forecast-engine ordering); then `src/lib/db/favorites.ts` (both fetchers +
   `FAVORITE_ORDER_BY`) + suite; then `src/actions/favorites.ts` + suite.
4. Drawer wiring: `DrawerFormData.favorites`, strip + tap-prefill (apply the helper's patch +
   the component-side session resets) + save affordance (§8.1–8.2).
5. `/settings` card (§8.3, incl. the degraded chip) + page `Promise.all` extension + the
   category-delete dialog copy clause (§8.4).
6. Docs pass (§13), `npm run test:run` + `npm run build`, then a manual browser pass on the
   `development` Neon branch: save a favorite from a filled drawer; reopen → chip appears;
   tap → wholesale prefill (null-amount favorite focuses the amount; archived-account favorite
   keeps the default account **and** shows the `/settings` warning chip); save the transaction
   through the normal flow; rename + delete on `/settings`; cap behaviour at 12; delete a
   custom category a favorite uses → dialog names the impact, favorite prefills Uncategorized.

---

## 13. Docs to update when shipping

- [POST-MVP-ROADMAP.md](../POST-MVP-ROADMAP.md) — §19 shipped banner + Delivery Sequence
  row 15 (the committed tier is then fully shipped) + Open question #10 (favorites half)
  resolved: **free**.
- [project-overview.md](../project-overview.md) — Transactions feature note (favorites strip
  in the drawer; prefill-only, `createTransaction` stays the sole writer) + schema mirror
  gains the `Favorite` model.
- `/help` — Transactions line: favorites pre-fill the drawer and never save by themselves;
  saved from the drawer, managed on `/settings`.
- `docs/current-feature.md` — history entry on completion, per the standard workflow.
