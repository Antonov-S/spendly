# Favorites Follow-Ups — Assessment & Implementation Spec

> **Goal:** Resolve the four deferred follow-ups named in
> [quick-add-favorites-spec.md](./quick-add-favorites-spec.md) §10 — **full field editing on
> `/settings`**, **manual reordering**, the **post-save "save this as a favorite?" nudge**, and
> **tags/splits on favorites** — into explicit build / defer / reject decisions, and fully
> specify the slice worth building now.

Parent feature: `feature/quick-add-favorites` (shipped, POST-MVP §19, Delivery slot 15).
Proposed branch for the recommended slice: `feature/favorites-editing-reorder`.

---

## 0. Verdict summary

| Follow-up | Verdict | Why (one line) |
|---|---|---|
| **Full field editing on `/settings`** | **Build now** | The parent spec's own committed first follow-up (D5); zero schema change; it also turns the archived-account warning chip from *informational* into *repairable*. |
| **Manual reordering on `/settings`** | **Build now — as accessible move controls, not a drag library** | The seam is one nullable column + a one-line `FAVORITE_ORDER_BY` edit; the muscle-memory value D6 named is real, but the *drag gesture* is the expensive, touch-hostile part — up/down controls deliver the same value dependency-free. |
| **Post-save "save as favorite?" nudge** | **Defer — hard-gated on a real telemetry sink** | The parent spec's own bar ("needs precision tuning + telemetry to prove it isn't nagging") is currently *unmeetable*: `track()` is a no-op shim, so nagging-vs-useful cannot be measured. Costs a new mute model + detection engine for unproven value. |
| **Tags on favorites** | **Defer — evidence-gated** | Extension contract already written (parent §10); a join table + staleness handling for a secondary field, with no evidence yet that tags are central to *repeat* captures. |
| **Splits on favorites** | **Reject for the foreseeable future** | The narrowest value of all: only fixed-amount EXPENSE favorites qualify, and a repeated capture that splits *identically every time* (same lines, same cents) is a near-empty set — splits vary by nature. Full `FavoriteSplit` child table for that is cost without a user. |

The two "build now" items bundle into **one small slice** — both surfaces are the `/settings`
Favorites card, both extend the same action file, and neither touches the drawer's prefill
contract. Bundling precedent: the Onboarding + Currency slice.

---

## 1. Why these two, why now

The v1 spec deliberately shipped `updateFavorite` as rename-only (D5) and name-ascending
ordering (D6) to keep the slice small — both were recorded as *planned, not rejected*, with
their seams named. At v1 volumes (a user with 2–3 favorites) delete + re-save was acceptable;
the friction compounds as favorites accumulate toward the `FAVORITE_MAX_COUNT = 12` cap:

- **Editing:** changing Coffee from €3.50 to €3.80 currently means delete on `/settings`, then
  reconstruct all seven fields in the drawer. A price change is the *most common* maintenance
  event a favorite will ever see, and it costs the full authoring flow.
- **Repair:** the `/settings` card already flags `Account archived · uses your default`
  (parent §8.3) but offers no action — "repair = delete + re-save" was the documented v1
  answer. Field editing *is* the repair path: open the edit drawer, pick a live account, save.
- **Ordering:** the chip grid is the muscle-memory surface (D6's whole argument against MRU).
  Alphabetical order means saving "Beer" shoves "Coffee" one cell over — exactly the
  chips-jumping-under-the-finger failure MRU was rejected for, just triggered by *creation*
  instead of usage. User-controlled order fixes it permanently and cheaply.

Neither item adds a write path to the ledger, touches the prefill contract
(`buildFavoritePrefill` is unchanged), or reads `src/lib/ai/`. `createTransaction` remains the
sole ledger writer; this slice only edits the shortcut store.

---

## 2. Scope

### In scope

- **Full-field `updateFavorite`** — schema widened to the create field set, action gains
  reference validation, `/settings` gains a small edit drawer replacing the rename-only input
  (§4–§6).
- **`sortOrder` column + `reorderFavorites` action + move controls** on the `/settings` card
  (§7). Ordering flips in exactly one place (`FAVORITE_ORDER_BY`), so the drawer strip and the
  `/settings` list move together by construction.
- Vitest coverage for the widened validation, both actions, and the new ordering (§9).

### Out of scope (explicit)

- **No drag-and-drop library** (`dnd-kit`, `sortablejs`, …) and no hand-rolled HTML5 DnD.
  HTML5 DnD does not work on touch (the mobile bottom-sheet users this feature serves most);
  pointer-event drag done properly (ghost element, auto-scroll, a11y announcements) is a
  project in itself. Move up/down buttons are keyboard-, touch-, and screen-reader-accessible
  for free and reach the same end state. If real drag ever proves worth it, it layers on top
  of the same `sortOrder` + `reorderFavorites` seam with zero backend change.
- **No editing from the drawer.** The drawer stays capture-only (tap chip → prefill →
  Save transaction). Long-press/right-click chip affordances are mobile-theme (§14) material.
- **No changes to `createFavorite`, the prefill helper, the chip grid, or telemetry events.**
- **Nudge, tags, splits** — see §10–§12 verdicts; not in this slice.

---

## 3. Data model (one additive migration `add_favorite_sort_order`)

```prisma
model Favorite {
  // ... existing fields unchanged ...
  sortOrder Int?   // null = never manually ordered; sorts after ordered rows, then name asc
}
```

- Nullable by design: existing favorites keep their alphabetical order until the user first
  reorders — the change is invisible until used (the parent spec's exact seam).
- No index needed: per-user row count is capped at 12.
- No other schema change. Full field editing needs none — every editable column already
  exists.

---

## 4. Validation (`src/lib/validations/favorite.ts`)

```ts
// Widened from { name } to the full create field set — the parent spec's D5 seam:
// "same rules, so create and edit can never diverge."
export const updateFavoriteSchema = createFavoriteSchema;
export type UpdateFavoriteInput = z.infer<typeof updateFavoriteSchema>;

// New:
export const reorderFavoritesSchema = z.object({
  ids: z.array(z.string().trim().min(1)).min(1).max(FAVORITE_MAX_COUNT),
});
```

Aliasing (not copying) `createFavoriteSchema` is the whole point: a future rule change
(say, a new amount bound) applies to create and edit in one edit, provably.

**No shared ID schema exists in the codebase** (checked: no `idSchema`/cuid helper in
`src/lib/validations/`; every file inlines its id rule). The `ids` shape above follows the
closest precedent — `tagIds` in `validations/transaction.ts`
(`z.array(z.string().min(1)).max(N)`, with ownership checked in the action, never the
schema). Do not invent a shared helper for this slice; that is a `refactor-scanner`
consolidation for another day.

---

## 5. Actions (`src/actions/favorites.ts`)

### 5.1 `updateFavorite(id, input)` — widened

Keeps its existing shape (auth → ownership `findFirst({ id, userId })` → name dedup with
`editingId` → write → `revalidatePath("/settings")`), gaining:

1. **Reference validation via the existing `resolveFavoriteReferences`** — the same
   visible-category / owned-active-account rules as create. One deliberate nuance:
   - **Unchanged archived account is allowed.** The action fetches the existing row's
     `financialAccountId`; if the submitted id equals the stored id, the account check is
     skipped. Editing Coffee's *amount* must not be blocked because its *account* was archived
     last month — that would make the degraded favorite uneditable, the opposite of repair.
     A **changed** account id goes through the full owned-and-active gate, so an archived
     account can never be newly pointed at (parity with create).
2. **`amount` normalization** — `round2` when set, `null` when blank (prompt-on-use), same as
   create.
3. The rename-only fast path disappears; rename is just an edit that changes one field.

### 5.2 `reorderFavorites(input)` — new

- Auth → `reorderFavoritesSchema.safeParse` → dedupe ids via `new Set` (reject on duplicates).
- **All-or-nothing ownership**: `favorite.count({ where: { userId, id: { in: ids } } })`
  must equal `ids.length` — the `resolveOwnedTagIds` pattern. A stale id (deleted in another
  tab) fails the whole call with "Favorites changed — reload and try again." rather than
  silently part-ordering.
- **Partial lists are valid, and omission means un-ordering.** The client always sends the
  full current list, but the server does not require every favorite to be present. The
  post-call invariant is: **rows with a non-null `sortOrder` are exactly the payload rows,
  in payload order; everything else is `null` and sorts after, by name.** Concretely, the
  transaction also runs `updateMany({ where: { userId, id: { notIn: ids } }, data:
  { sortOrder: null } })` — so a previously-ordered row omitted from a later payload is
  *reset to null*, never left holding a stale index that would interleave unpredictably with
  the new indices. This makes the action safe against a favorite created mid-reorder in
  another tab (it was null and stays null) and keeps the ordering state fully determined by
  the most recent call, with no history dependence.
- Write: one `prisma.$transaction` of `update({ where: { id }, data: { sortOrder: index } })`
  calls plus the omitted-rows `updateMany` reset above. Twelve rows max — no batching
  concern.
- `revalidatePath("/settings")`. The drawer needs nothing (fetches fresh per open, as always).

---

## 6. DB layer (`src/lib/db/favorites.ts`)

The one-place ordering edit the parent spec designed for:

```ts
export const FAVORITE_ORDER_BY = [
  { sortOrder: { sort: "asc", nulls: "last" } },
  { name: "asc" },
] as const;
```

Both fetchers already consume this constant — neither carries its own `orderBy` literal — so
the drawer strip and `/settings` list flip together with **zero fetcher edits** beyond the
constant, and the select projections gain nothing (`sortOrder` never needs to reach the
client; position is expressed by array order).

---

## 7. UI (`src/components/favorites/manage-favorites.tsx` + one new drawer)

### 7.1 Edit drawer (`src/components/favorites/favorite-form-drawer.tsx`, new)

- A small Sheet (right panel ≥768px / bottom sheet <768px — the house drawer pattern),
  opened from an **Edit** action on each `/settings` row (replacing the rename-only inline
  input). Fields, top to bottom: name, type toggle (INCOME/EXPENSE), amount (blank = "ask
  every time" — caption the prompt-on-use semantics explicitly), `<CategoryPickerField>`
  (reused, with its "+ New category" affordance), account select (active accounts only,
  plus an explicit "Drawer default" empty option), merchant, note. A **subset of the
  transaction drawer, not a copy** — no date, no splits, no tags, no AI affordances.
- **Archived-account repair:** when the stored account is archived it cannot appear in the
  active-only select; the select renders the "Drawer default" option selected with a one-line
  amber note ("Previously used <name>, now archived."). Saving with any selection — including
  leaving "Drawer default" — clears or replaces the stale reference. The §8.3 warning chip
  disappears on the next render because the reference is gone. (Keeping the archived id
  requires submitting it unchanged, which this select can't do — acceptable: the user opened
  Edit to repair.)
- Save calls `updateFavorite`; on success, toast + close. Duplicate-name and cap errors
  surface inline, same copy as the drawer's save affordance.

### 7.2 Move controls

- Each row gains **↑ / ↓ icon buttons** (first row's ↑ and last row's ↓ disabled) with
  `aria-label="Move <name> up/down"`. A tap swaps the row locally (optimistic state) and
  fires `reorderFavorites` with the full new id order; on failure, revert the local swap and
  toast. **Exact toast copy:** the action's error message when one is returned (i.e.
  `Favorites changed — reload and try again.` for the ownership-mismatch case), else the
  generic fallback `Couldn't reorder favorites — previous order restored.` One toast per
  failed call, error-toned, no retry action (the revert already restored a consistent state;
  the next tap is the retry).
- No persistent "edit mode" toggle — with ≤12 rows the two small icon buttons per row are
  quiet enough to live inline, and mode toggles cost a tap the feature exists to save.
- The chip grid in the drawer needs **no change**: it renders `getUserFavorites` order, which
  now follows `sortOrder`.

### 7.3 Row summary line

Unchanged, except the rename affordance folds into Edit. Delete + confirm `<dialog>` stay
as shipped.

---

## 8. Edge cases & rules

- **Reorder + concurrent delete** → ownership count mismatch → whole call rejected with a
  reload hint; the optimistic swap reverts. No partial order is ever persisted.
- **Reorder + concurrent create** → the new favorite has `sortOrder: null`, is untouched by
  the omitted-rows reset (it was already null), and sorts after all ordered rows by name.
  Deterministic, no error.
- **Previously-ordered row omitted from a later payload** → reset to `sortOrder: null` by the
  `updateMany` in the same transaction (§5.2 invariant). The UI always sends the full list, so
  this only arises from a non-UI caller or a race — either way the outcome is defined, not
  accidental.
- **Concurrent reorders from two tabs → last-write-wins, deliberately.** Each call replaces
  the entire ordering state atomically (§5.2 invariant), so two racing calls resolve to
  whichever transaction commits second — a complete, self-consistent order, never an
  interleaving of the two. No version/timestamp guard is added: favorite ordering is
  **preference state, not ledger data** — the loser's tab shows the winner's order on next
  render, and the "loss" costs one re-tap. Optimistic-lock machinery here would be weight
  without a failure mode worth preventing.
- **Edit collides on name (any case)** → the existing three dedup layers already handle it
  (`assertFavoriteNameAvailable` takes `editingId`; the functional CI index + `P2002` map are
  untouched).
- **Edit sets amount blank on a fixed-amount favorite** → becomes prompt-on-use (null), the
  chip drops its amount line on next drawer open. Symmetric and intentional.
- **Type change EXPENSE ↔ INCOME** → allowed; the favorite is drawer state, no ledger rows
  reference it. TRANSFER remains rejected by the shared schema.
- **Telemetry** — none new. `favorite_created` / `favorite_used` / `favorite_deleted` stay
  as shipped; an edit or reorder is maintenance, not a capture signal.

---

## 9. Testing (Vitest — actions + lib per standards; components out of scope)

- **`test/lib/validations/favorite.test.ts`** — `updateFavoriteSchema` is
  reference-identical to `createFavoriteSchema` (the never-diverge guarantee, tested as
  `toBe`); `reorderFavoritesSchema` bounds (empty rejected, > `FAVORITE_MAX_COUNT` rejected).
- **`test/actions/favorites.test.ts`** — widened `updateFavorite`: reference validation
  called; **unchanged archived account passes** while a *changed* archived account is
  rejected (the repair rule, both directions); amount `round2`/null normalization; existing
  ownership/dedup cases still green. New `reorderFavorites`: auth guard; duplicate ids
  rejected; ownership count mismatch rejects whole call; `$transaction` receives one update
  per id with `sortOrder` = array index **plus** the omitted-rows
  `updateMany({ where: { userId, id: { notIn: ids } }, data: { sortOrder: null } })` reset
  (the §5.2 invariant, asserted on where-shape and data); `revalidatePath("/settings")`.
- **`test/lib/db/favorites.test.ts`** — `FAVORITE_ORDER_BY` shape is the two-term array with
  `nulls: "last"`; both fetchers still pass the shared constant.

`npm run test:run` and `npm run build` must pass before commit.

---

## 10. Deferred: post-save "save this as a favorite?" nudge

**Verdict: defer.** The parent spec already held this to a bar — "needs its own precision
tuning + telemetry to prove it isn't nagging" — and that bar is currently **impossible to
meet**: `track()` is the no-op shim, so neither the trigger's precision nor dismissal rates
can be observed. Shipping a nudge whose nagging-rate is unmeasurable violates the roadmap's
calm-not-nagging principle by construction.

It is also the most expensive of the four follow-ups: a detection engine (counting captures
by `(normalizeLabelKey(merchant), type)`, thresholds, suppression against existing favorites
*and* templates), a **new mute model** mirroring `RecurringSuggestionMute` (a false nudge has
no resolution path otherwise), and a new UI surface under the save toast — all for a
discoverability problem the drawer's always-visible "Save as favorite" button may already
solve.

**Unblock gates (both required):**
1. A real telemetry sink replaces the shim (the roadmap's §0 analytics slice).
2. Evidence of the gap: users with repeated same-merchant captures who have **not** saved a
   matching favorite (measurable once gate 1 lands).

The parent spec's design sketch (§10, Deferred) remains the contract when built:
deterministic threshold, `RecurringSuggestionMute`-style persistence, accept opens the
existing name input pre-filled, nothing auto-creates.

---

## 11. Deferred: tags on favorites

**Verdict: defer, evidence-gated.** The extension contract is already written (parent §10:
`FavoriteTag` join mirroring `TransactionTag`, prefill filters stale ids, cap shared with
`TAG_MAX_PER_TRANSACTION`) — nothing needs re-deciding, which is precisely why there is no
urgency. The cost is a join table plus staleness handling for what is, on a *capture
shortcut*, a secondary field: the favorites thesis is "the fifth coffee this week," and a
coffee rarely carries `reimbursable`.

**Unblock gate:** telemetry (post-shim) showing tags used on a meaningful share of
transactions created *via* favorites — i.e., users manually re-adding the same tags after
every chip tap. That is the friction this extension would remove; until it's observed, the
extension removes nothing.

---

## 12. Rejected (for the foreseeable future): splits on favorites

**Verdict: reject.** The parent contract itself narrows this to fixed-amount EXPENSE
favorites only — a prompt-on-use favorite cannot carry lines that must sum to an unknown
total. Inside that narrow set, the user who benefits is one whose repeated purchase splits
**identically to the cent every time** (same lines, same amounts). Real split use — the €80
shop that's €55/€25 *this* week — varies per trip, so the prefilled lines would need editing
anyway, at which point the favorite saved nothing over entering split mode manually. A full
`FavoriteSplit` child table, sum validation, and SetNull degradation handling is real cost
against a near-empty user set.

Not deleted from the record: the extension contract in the parent spec §10 stays as written,
so if a concrete user pattern ever surfaces (e.g., a fixed salary-deduction entry split into
constant categories), the door reopens without redesign. But no gate is defined because no
plausible evidence stream exists — rejection, not deferral, is the honest label.

---

## 13. Implementation order (recommended slice)

1. Migration `add_favorite_sort_order` (plain additive) via `prisma migrate dev` on the
   `development` Neon branch; `prisma migrate status` clean.
2. Validation: alias `updateFavoriteSchema`, add `reorderFavoritesSchema` + suite updates.
3. Actions: widen `updateFavorite` (references + unchanged-archived-account rule + amount
   normalization), add `reorderFavorites` + suite.
4. DB: flip `FAVORITE_ORDER_BY` to the two-term array + suite.
5. UI: `favorite-form-drawer.tsx` (new), fold rename into Edit, add move controls to
   `manage-favorites.tsx`.
6. Gates: `npm run test:run`, `npm run build`, lint. Manual browser pass:
   - edit every field, incl. blanking the amount (fixed → prompt-on-use);
   - **archived-account repair, both paths, verified at the reference level** — open Edit on
     a favorite whose stored account is archived: (a) save with "Drawer default" selected →
     `financialAccountId` is cleared to null; (b) save with a live account selected → the
     stale reference is replaced with the new id. In both cases the `/settings` warning chip
     is gone on the next render and the next drawer prefill uses the expected account (the
     current default in (a), the chosen account in (b));
   - reorder and confirm the drawer chip grid follows the new order on next open;
   - concurrent-delete reorder → whole call rejected, optimistic swap reverts, the exact
     §7.2 toast copy shows.

---

## 14. Docs to update when shipping

- [quick-add-favorites-spec.md](./quick-add-favorites-spec.md) — flip the D5/D6 "Deferred"
  entries to shipped pointers at this spec.
- [POST-MVP-ROADMAP.md](../POST-MVP-ROADMAP.md) — note under §19 that the committed
  follow-ups landed; record the nudge/tags gates and the splits rejection.
- [project-overview.md](../project-overview.md) — Quick-add favorites note: "renamed or
  deleted" on `/settings` becomes "edited, reordered, or deleted"; schema mirror gains
  `sortOrder`.
- `/help` — Transactions favorites line gains "edit or reorder them in Settings."
- `docs/current-feature.md` — history entry on completion, per the standard workflow.
