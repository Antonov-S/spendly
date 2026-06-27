# Natural-Language Quick Capture (Pro) — Implementation Spec

> **✅ Status: Shipped (`feature/nl-quick-capture`).** Delivered as specified: the Pro-only "Quick add"
> NL field at the top of the create-mode transaction drawer; `parseTransaction` thin over `runAiFeature`
> (suggestion-only, never writes); amount-required → `no_match`, category soft-degrades to null; account
> never auto-set; single transaction v1; reuses the §3 foundation. **Post-build tuning (from live QA):**
> the prompt iterated to **v2** (currency-word amount extraction + category inference); `parseDraftJson`
> coerces numeric-string amounts; and a shared-foundation latency fix — `gpt-5-nano`'s default `medium`
> reasoning effort breached the timeout, so `AI_REASONING_EFFORT = "low"` (added) + `AI_TIMEOUT_MS`
> raised 8000→12000 (the sweet spot: `medium`-quality categories at ~2–3s). `ParseConfidence` is declared
> in `parse.ts` (not re-exported from the `"use server"` action — Turbopack emits that as a runtime
> binding). 558 tests pass, build + lint clean. This spec implements
> [POST-MVP-ROADMAP.md](../POST-MVP-ROADMAP.md) §4
> (Delivery Sequence **slot 4**) — the firm slice after the §3 AI foundation. It is the
> **least-experimental AI assistant** and a direct servant of the 5-second-capture goal, which is why
> it is the one AI assistant inside the firm committed sequence (the insight assistants §5–§6 are
> committed but value-ordered behind Budget Rollover).
>
> **Reuses, unchanged, the §3 foundation** (`feature/ai-auto-categorization`,
> [ai-auto-categorization-spec.md](ai-auto-categorization-spec.md)): the lazy OpenAI client
> (`src/lib/ai/client.ts`), the `aiJsonRespond` Responses-API wrapper (`src/lib/ai/respond.ts`), the
> `runAiFeature` orchestrator (`src/lib/ai/run.ts` — auth → DB Pro gate → rate/cap → timeout →
> telemetry → fail-open), the `getAiProfile` Pro read (`src/lib/db/ai.ts`), the `track()` telemetry
> shim (`src/lib/analytics/track.ts`), the `AiParseError`/`AiNoMatchError` sentinels
> (`src/lib/ai/errors.ts`), and the `--color-ai` accent. **This slice adds only a prompt + parse step +
> a UI field** — exactly the seam §3 left open (its D6).

> **Goal:** A **Pro** user types or pastes one line — `"12 lunch at Pret yesterday"`,
> `"groceries 54.30 amazon"`, `"rent 1200 on the 1st"` — and gets a **pre-filled, unsaved transaction
> draft** (type, amount, date, category, merchant, note) in the normal drawer to confirm or edit. The
> ledger is **never written by the parse** — `createTransaction` stays the sole writer, identical to
> how recurring templates produce confirmable drafts. Free users see no quick-add field.

---

## 1. Why this slice

NL Quick Capture is the most on-philosophy AI feature in the roadmap: it removes typing burden while
**preserving the conscious-capture confirm moment** (the parse fills the drawer; the user still presses
Save). It is also the lowest-risk *next* AI build because the entire cross-cutting envelope already
exists and is audited in one place (`runAiFeature`). Per the §3 spec's D6 and "Extension points", a new
AI feature should be **"prompt + parse step only"** — this slice is the first proof of that claim.

It is sliced independently from §3: auto-categorization suggests *one field* in an already-open drawer;
quick capture parses *a whole draft* from free text. They share the foundation but not the prompt, the
output shape, or the surface.

---

## 2. Scope

### In scope

- **`parseTransaction` server action** (`src/actions/ai/parse-transaction.ts`) — a thin wrapper over
  `runAiFeature` that supplies the parse prompt + a parse/match/guard step and returns a
  `ParsedTransactionDraft` *suggestion object*. Never writes.
- **Versioned parse prompt** (`src/lib/ai/prompts/transaction.ts`) — `PARSE_INSTRUCTIONS`,
  `buildParseInput`, and `TRANSACTION_PARSE_PROMPT_VERSION` (start at `1`), mirroring the category
  prompt module so §9-style telemetry can compare prompt iterations.
- **Pure parse/guard helpers** (`src/lib/ai/parse.ts`) — `parseDraftJson` (defensive JSON → normalized
  fields) + `resolveDraftDate` (validate `YYYY-MM-DD`, fall back to today) + reuse of the existing
  `matchCategoryByName` (`src/lib/ai/category.ts`). Unit-testable without the SDK.
- **Drawer UI** — a Pro-only **"Quick add"** natural-language field at the top of the **create-mode**
  drawer (light-blue AI accent, Sparkles). On parse it pre-fills the existing form fields; nothing is
  saved. Hidden entirely for Free users and in edit mode.
- **Outcome telemetry** — a `trackParseOutcome` action (mirrors `trackCategoryOutcome`) emitting
  whether a parse-originated entry was confirmed and whether it was edited first, so "% confirmed
  without heavy edits" (the roadmap §4 success metric) is measurable the day §0's sink lands.
- **Validation** — `parseTransactionSchema` added to `src/lib/validations/ai.ts`.
- **Vitest** — unit tests for the action (Pro gate via the mocked orchestrator path, amount-missing →
  `no_match`, category degrade-to-null, date fallback, truncation) and the pure helpers. Mock OpenAI at
  the module boundary, like §3 / Stripe / Resend. No live calls.

### Out of scope

- **Multi-transaction input** (`"groceries 40 and gas 30"`) — v1 parses **one** transaction (the most
  salient). Recorded as an extension point (§11, D6). Decided, not deferred-by-omission.
- **Transfers.** The parse only ever produces `INCOME` / `EXPENSE`; a "moved €X from A to B" phrasing is
  not modeled in v1 (transfers need two accounts the model can't reliably resolve). The drawer's normal
  transfer flow is untouched.
- **A dedicated quick-add bar** outside the drawer (dashboard/transactions hero) — v1 keeps the NL field
  *inside* the drawer (D1). The dedicated surface is the natural follow-on and the design leaves the
  exact seam open (§11).
- **Any new write path, rate-limit policy, Pro-gate read, client, or telemetry sink.** All reused from
  §3. No `RATE_LIMITS` entry is added (see §5.3). The §0 sink is still a separate, product-owner-gated
  slice; this ships instrumented through the existing shim.
- **No schema change. No migration.** No model stores parse output.

---

## 3. The parsed-draft contract

`src/actions/ai/parse-transaction.ts`:

```ts
/** Coarse confidence flag. v1 is "high" | "low"; this alias is the SINGLE place
 *  to widen later (e.g. add "medium"). The UI keys off `=== "high"` (anything
 *  else → "check this draft"), so a new tier needs no UI change — see §5.2 / D9. */
export type ParseConfidence = "high" | "low";

/** A transaction draft parsed from one line of natural language. Pre-fills the
 *  drawer for the user to confirm — never written. */
export interface ParsedTransactionDraft {
  type: "INCOME" | "EXPENSE";       // never TRANSFER in v1
  amount: number;                   // positive magnitude; sign is derived on save by createTransaction
  date: string;                     // "YYYY-MM-DD", validated/guarded server-side (calendar date, no UTC)
  categoryId: string | null;        // matched to one of the user's categories, or null (manual picker)
  categoryName: string | null;      // resolved name for display
  merchant: string | null;          // extracted merchant, or null
  note: string | null;              // leftover descriptive text, or null
  confidence: ParseConfidence;      // coarse flag → UI emphasis (non-"high" = "check this draft")
  promptVersion: number;            // echoed so confirm/edit telemetry tags the right version
}

// Reuses the shared AiResult<T> from runAiFeature.
export type ParseResult = AiResult<ParsedTransactionDraft>;

export async function parseTransaction(input: { text: string }): Promise<ParseResult>;
```

**`amount` is the hard requirement.** A draft with no readable amount is useless, so when the model
cannot extract one the `run` step throws `AiNoMatchError` → `runAiFeature` maps it to
`reason: "no_match"` → the drawer fails open ("Couldn't read that — add the details manually."). This is
exactly the reserved use the §3 spec called out for `AiNoMatchError` ("§4 NL-parse with no parseable
amount"). **`categoryId` is soft** — an unmatched/absent category degrades to `null` (manual picker),
never an error, identical to `suggestCategory`.

---

## 4. Control flow — thin over `runAiFeature`

The action validates input (§4.1), truncates free-text, then delegates the whole envelope to the
foundation. The roadmap policy guarantees (Pro read **fresh from the DB, never the JWT**; **both** the
per-feature burst budget and the global `aiMonthly` COGS cap consumed; **any** throw/timeout → fail open)
are enforced once, in `runAiFeature`, not re-implemented here:

```ts
return runAiFeature({
  feature: "transaction_parse",
  promptVersion: TRANSACTION_PARSE_PROMPT_VERSION,
  burstLimit: "aiSuggest", // shared POLICY, separate BUCKET (key is `${feature}:${userId}`) — see §5.3
  failOpenMessage: "Couldn't read that — add the details manually.",
  run: async ({ userId, signal }) => {
    const categories = await getUserCategories(userId);           // system + own (reused fetcher)
    const raw = await aiJsonRespond({
      instructions: PARSE_INSTRUCTIONS,
      input: buildParseInput({
        text: clippedText,
        candidateNames: categories.map((c) => c.name),
        today: todayDateInputValue(),                             // model resolves "yesterday" against this
      }),
      signal,
    });

    const draft = parseDraftJson(raw);                           // throws AiParseError on bad JSON
    if (draft.amount == null) throw new AiNoMatchError("No amount in input.");
    const match = matchCategoryByName(draft.category, categories); // null when unmatched (soft)

    return {
      type: draft.type,
      amount: draft.amount,
      date: resolveDraftDate(draft.date),                        // guard → today on invalid/absent
      categoryId: match?.id ?? null,
      categoryName: match?.name ?? null,
      merchant: draft.merchant,
      note: draft.note,
      confidence: draft.confidence,
      promptVersion: TRANSACTION_PARSE_PROMPT_VERSION,
    } satisfies ParsedTransactionDraft;
  },
});
```

### 4.1 Validation — extend `src/lib/validations/ai.ts`

```ts
/** Input to the `parseTransaction` AI action. Free-text length is enforced by the
 *  action's clip() (truncate to AI_INPUT_MAX_CHARS before the call) like
 *  suggestCategory — over-long input is truncated, never rejected. */
export const parseTransactionSchema = z.object({
  text: z.string().min(1, "Type what you spent."),
});
export type ParseTransactionInput = z.infer<typeof parseTransactionSchema>;
```

The action clips `text` to `AI_INPUT_MAX_CHARS` before the call (reused constant — defense in depth +
token control), exactly as `suggestCategory.clip()` does today.

---

## 5. Prompt, parsing, and the gotchas that carry over

### 5.1 Prompt — `src/lib/ai/prompts/transaction.ts`

Versioned and changelogged, mirroring `prompts/category.ts`:

```ts
/** Changelog: v1 — initial: extract a single transaction; resolve relative dates
 *  against `today`; pick one category from the list or null. */
export const TRANSACTION_PARSE_PROMPT_VERSION = 1;

export const PARSE_INSTRUCTIONS = [
  "You extract ONE personal-finance transaction from a short note.",
  "Respond as JSON: { \"type\": \"INCOME\"|\"EXPENSE\", \"amount\": <positive number or null>,",
  "\"date\": <\"YYYY-MM-DD\">, \"category\": <name from the provided list, or null>,",
  "\"merchant\": <store/payee or null>, \"note\": <leftover detail or null>,",
  "\"confidence\": \"high\"|\"low\" }.",
  "Default type to EXPENSE unless the text clearly describes income (salary, refund, paid).",
  "Resolve relative dates (today, yesterday, last friday, the 1st) against the provided `today`.",
  "If no date is mentioned, use `today`. If no amount can be read, return amount null.",
  "Choose the single best category from the list ONLY — never invent one; use null when unsure.",
].join(" ");

export function buildParseInput(args: {
  text: string;
  candidateNames: string[];
  today: string; // YYYY-MM-DD
}): string {
  return JSON.stringify({ today: args.today, categories: args.candidateNames, note: args.text });
}
```

### 5.2 Parsing — `src/lib/ai/parse.ts`

Defensive, mirroring `parseSuggestionJson`:

- `parseDraftJson(raw)` — `JSON.parse` with an `AiParseError` on non-JSON; coerce/normalize each field:
  `type` → `"INCOME"` only when the model said so, else `"EXPENSE"`; `amount` → a finite **positive**
  number or `null` (`Math.abs`, reject `NaN`/`0`/non-number); `confidence` → the matched
  `ParseConfidence` tier, defaulting to `"low"` for any unrecognized value (today: `"high"` only when
  exactly `"high"`; widening to accept `"medium"` is a one-line change here — the parser is the single
  gate so the UI's `=== "high"` check keeps working, D9); `category` → lowercased/trimmed or `null` (then handed to the existing
  `matchCategoryByName`, which never invents an id); `merchant`/`note` → trimmed non-empty string or
  `null`. A well-formed payload with `amount: null` is **not** a parse error — it returns `amount: null`
  and the *action* turns that into `AiNoMatchError` (§3), keeping "unparseable JSON" and "no amount"
  distinct in telemetry.
- `resolveDraftDate(value)` — return `value` when it matches `^\d{4}-\d{2}-\d{2}$`, else
  `todayDateInputValue()`. No UTC coercion — consistent with the calendar-date architecture decision and
  the drawer's existing date handling.

Reuse `matchCategoryByName` and `CategoryOption` from `src/lib/ai/category.ts` / `@/types/transactions`
— do not duplicate matching.

### 5.3 Rate limiting — reuse `aiSuggest`, no new entry

`runAiFeature` keys the per-feature burst budget by `` `${feature}:${userId}` ``, so passing
`burstLimit: "aiSuggest"` with `feature: "transaction_parse"` already gives this feature its **own
bucket**, separate from `category_suggest`, while sharing the same 20/h policy numbers — precisely the
"each AI feature gets its own bucket so one can't starve another" design from §3/§8. The **global**
`aiMonthly` COGS ceiling (keyed by `userId` alone) is applied by `runAiFeature` on every call and is
**shared** across all AI features, which is the point: total AI COGS is budgeted per Pro user, not per
feature. **No `RATE_LIMITS` change is needed.**

### 5.4 Responses-API gotchas (carried, still load-bearing)

The §3 "CRITICAL" rules still apply because we call the same `aiJsonRespond` wrapper: **Responses API,
not Chat Completions** (`gpt-5-nano` returns empty content on Chat Completions); `json_object` format,
**parse manually** (no `zodResponseFormat` — it blows the token budget); the literal word "json" must
appear in the input (it does, via the JSON-shaped `buildParseInput` payload and the instructions);
normalize strings after receiving them. All of this is already encapsulated in `respond.ts` — this slice
inherits it.

---

## 6. UI integration — the drawer "Quick add" field

The drawer ([transaction-drawer.tsx](../../src/components/transactions/transaction-drawer.tsx)) gains a
**Quick add** natural-language field rendered at the **top of the form body, above the type toggle**,
**only in create mode and only for Pro** (`isPro` is already on `DrawerFormData` from §3 —
`formData?.isPro`). It is hidden when `isEdit` (editing pre-fills from an existing row — NL parse has no
meaning there).

- **Field** — a single-line text input + a Sparkles **"Parse"** button using the AI accent
  (`text-ai`, `hover:bg-ai/10`), matching the existing Suggest button's styling. Pressing **Enter** in
  the field triggers parse. Disabled while a parse is in flight (`useTransition`, "Reading…").
- **Autofocus (D10) — focus the Quick add field on create-drawer open, desktop only.** When the drawer
  opens in create mode for a Pro user on a pointer/desktop viewport (`isDesktop`, the existing
  `useMediaQuery` flag), the Quick add input receives focus so a power user can type the line and hit
  Enter without a click — the 5-second-capture optimization. **Suppressed on mobile** (`!isDesktop`) so
  the on-screen keyboard doesn't immediately cover the form before the user has decided between NL and
  manual entry. Never autofocuses in edit mode (the field isn't rendered) or for Free users.
- **Repeated / in-flight Parse (D11) — always a fresh request; never coalesce or cache.** The button is
  disabled while a parse is in flight, so identical concurrent submits can't fire; once a parse
  resolves, each subsequent Parse starts a **new** request (no client-side dedupe, no result cache).
  Identical input may legitimately yield a refined draft, the call is cheap, and caching would add
  staleness for no benefit — the `aiSuggest` burst budget (§5.3) is the abuse rail, not a client cache.
- **On result** — pre-fill the existing form state from the draft: `setType`, `setAmount(String(...))`,
  `setDate`, `setCategoryId(draft.categoryId ?? "")`, `setMerchant`, `setNote`. The account is **not**
  set by the parse (it follows the existing topbar-scope default) — accounts aren't reliably nameable in
  one line. **Nothing is saved** — the user reviews and presses the normal Save.
- **The Quick add field is NOT cleared after a successful parse (D7).** The raw natural-language text is
  retained in its own local state (`quickAddText`) for the life of the drawer session, so the user can
  see what produced the draft and tweak-and-re-parse without retyping. It is **local-only** — never
  written to the DB (no schema change) and not sent to telemetry (it is free text → potential PII). It
  resets on drawer close/reopen alongside the other fields.
- **Re-parse after manual edits replaces the draft wholesale (D8).** Pressing Parse again overwrites all
  parse-owned fields (type / amount / date / category / merchant / note) from the new draft and **resets
  the edit snapshot** to that new draft; the account is still untouched. There is no field-level merge in
  v1 — wholesale replacement is predictable, and because the raw text is preserved the user can see
  exactly what they re-parsed. (Manual edits made before a re-parse are intentionally discarded; this is
  an explicit user action, not a background refresh.)
- **Low confidence** — when `confidence !== "high"`, render a subtle `text-ai` hint under the field ("AI
  draft — double-check the details."), reusing the §3 pattern. Keying off `!== "high"` (not `=== "low"`)
  means a future `"medium"` tier (D9) surfaces the same "check it" affordance with no UI change. The user
  is always the final arbiter.
- **Errors** — drive the message off the result `reason` (all fail-open, never a blocked form):
  `no_match` → "Couldn't read that — add the details manually."; `rate_limited` → "You've hit the hourly
  limit — enter it manually."; every other reason (`timeout`/`ai_error`/`parse_failed`) → the generic
  fail-open note. The form stays fully usable throughout.
- **Stale-result guard** — reuse the existing `suggestRunRef` monotonic-token pattern (or a sibling
  `parseRunRef`) so a slow parse that resolves after the drawer closed/reopened is discarded rather than
  landing on a fresh entry.
- **Edit-snapshot for telemetry** — when a parse pre-fills, snapshot the drafted field values
  (type/amount/date/category/merchant/note). On Save, compare each field against the snapshot and emit
  `trackParseOutcome` with both the headline `edited` boolean **and** a granular `editedFields` list
  (which of the drafted fields the user changed). The field **names** are safe to send (they are not PII
  or financial values — unlike the amounts/merchants themselves, which are never emitted). This turns a
  flat "edited" signal into a diagnosable one — e.g. "category is overridden 40% of the time, dates
  almost never" points the next prompt iteration at the weak field. (Discarding without saving emits
  nothing — `confirmed` is implicitly the save event, mirroring how `trackCategoryOutcome` only fires on
  Save. A re-parse resets this snapshot, D8.)

**Decisions (decisions over options):**

- **D1 — NL field lives *inside* the create-mode drawer, not a separate bar.** Lowest blast radius: no
  change to `useAppShell().openDrawer`'s signature, all state already lives in the drawer, and the
  "confirm in the normal drawer" contract is literal. A dedicated quick-add affordance is the follow-on
  (§11), gated on §0 showing NL adoption worth amplifying.
- **D2 — Parse on explicit click/Enter, never debounced "as you type."** Same rationale as §3 D1/D2: an
  explicit action is a deliberate, billable request; no surprise calls, on-thesis with conscious capture.
- **D3 — `amount` missing → `no_match` (fail open); `category` missing → `null` (soft).** The amount is
  the load-bearing field; the category is a convenience the manual picker already covers.
- **D4 — Account is never auto-set by the parse.** It keeps the existing topbar-scope default; one line
  rarely names an account unambiguously, and a wrong account is a balance error, not a label error.
- **D5 — Single transaction only in v1.** Multi-transaction input is an extension point (§11), not a
  silent partial behaviour.
- **D6 — Confirm-not-auto, no new write path.** The action returns a draft; `createTransaction` remains
  the sole writer. ✅ on-thesis (proves §3's "prompt + parse step only" claim).
- **D7 — The Quick add field is preserved after a parse, not cleared.** The raw NL text stays in local
  `quickAddText` for the drawer session (local-only, never persisted, never sent to telemetry) so the
  user can tweak-and-re-parse and see what produced the draft. Clearing it would force a retype for the
  most common correction loop.
- **D8 — Re-parse replaces the draft wholesale and resets the edit snapshot.** No field-level merge in
  v1: predictable over clever, and the preserved raw text (D7) makes the replacement legible. Manual
  edits before a re-parse are intentionally discarded — re-parse is an explicit request.
- **D9 — `confidence` is a `ParseConfidence` alias, widenable to add `"medium"` in one place.** v1 ships
  `"high" | "low"`, but the parser is the single normalization gate and the UI keys off `!== "high"`, so
  introducing a `"medium"` tier later is a one-line type + parser change with **zero** UI churn. Avoids a
  numeric score (brittle to parse, false precision) while not boxing the model into a binary forever.
- **D10 — Autofocus the Quick add field on create-open, desktop only.** Optimizes the primary capture
  flow for keyboard users; suppressed on mobile to avoid an immediate keyboard takeover before the user
  chooses NL vs. manual. (Open question #6 — the product owner may prefer no autofocus at all.)
- **D11 — Each Parse is a fresh request; no in-flight coalescing, no result cache.** The disabled-while-
  pending button prevents concurrent duplicates; repeated identical Parses always re-run. Simpler than
  coalescing/caching, avoids stale drafts, and the burst budget already bounds cost.

---

## 7. Telemetry

`runAiFeature` already emits **exactly one** `ai_result` per parse call (`feature:
"transaction_parse"`, `prompt_version`, `outcome`, `reason`) — acceptance/abandonment of the parse step
itself is free. This slice adds the *confirm* side via a thin action mirroring `trackCategoryOutcome`:

| Event | Emitted by | Props |
|---|---|---|
| `ai_result` | `runAiFeature` (server) — **always, once per parse** | `feature`, `prompt_version`, `outcome`, `reason` |
| `ai_parse_confirmed` | drawer on Save of a parse-originated entry | `feature`, `prompt_version`, `edited` (boolean), `edited_field_count` (number), `edited_fields` (comma-joined field names) |

`src/actions/ai/track-parse-outcome.ts` (`"use server"`):

```ts
/** Parse-owned fields whose post-parse edits we measure. NAMES only — never the
 *  values (which are PII/financial). */
type ParsedField = "type" | "amount" | "date" | "category" | "merchant" | "note";

export async function trackParseOutcome(input: {
  confirmed: boolean;          // reserved; v1 only emits on Save (confirmed=true)
  editedFields: ParsedField[]; // which drafted fields the user changed before Save
  promptVersion?: number;
}): Promise<void> {
  await track("ai_parse_confirmed", {
    feature: "transaction_parse",
    prompt_version: input.promptVersion ?? TRANSACTION_PARSE_PROMPT_VERSION,
    edited: input.editedFields.length > 0,            // headline metric
    edited_field_count: input.editedFields.length,    // how heavy the edit was
    edited_fields: input.editedFields.join(","),      // WHICH fields — points the next prompt iteration
  });
}
```

The roadmap §4 success metric — **% of NL captures confirmed without heavy edits** — is
`edited === false` over `ai_result(outcome="ok")`, sliceable by `prompt_version`; `edited_field_count`
distinguishes a one-field tweak from a near-rewrite, and `edited_fields` localizes the weakness to a
specific field. Field **names** only — no amounts, merchants, notes, or other values cross the shim, per
its no-PII / no-financial-values contract.

---

## 8. Files

**New — quick-capture feature**
- `src/actions/ai/parse-transaction.ts` — thin `parseTransaction` action over `runAiFeature`.
- `src/actions/ai/track-parse-outcome.ts` — `trackParseOutcome` telemetry action.
- `src/lib/ai/prompts/transaction.ts` — `PARSE_INSTRUCTIONS`, `buildParseInput`,
  `TRANSACTION_PARSE_PROMPT_VERSION` + changelog.
- `src/lib/ai/parse.ts` — pure `parseDraftJson` + `resolveDraftDate` (reuses `matchCategoryByName`).

**New — tests**
- `test/lib/ai/parse.test.ts` — `parseDraftJson` (wrapped shape, bad JSON → `AiParseError`,
  `amount: null` is not an error, type/confidence/merchant normalization) + `resolveDraftDate`
  (valid passthrough, invalid/empty → today).
- `test/actions/ai/parse-transaction.test.ts` — well-formed mock → matched draft with `promptVersion`;
  amount-missing → `reason: "no_match"`; unmatched category → `categoryId: null`; over-long text
  truncated before the call; rejects empty input. Mock OpenAI + the `runAiFeature` deps (`auth`,
  `checkRateLimit`, `getAiProfile`, `track`) at the module boundary.

**Modified**
- `src/lib/validations/ai.ts` — add `parseTransactionSchema`.
- `src/components/transactions/transaction-drawer.tsx` — the Quick add field (Pro, create-mode), parse
  wiring, retained `quickAddText` + re-parse (D7/D8), drafted-field snapshot, and the granular
  `trackParseOutcome` on Save.
- `docs/project-overview.md` — once shipped, add a one-line note under **Out of Scope** /
  **Transactions** that NL Quick Capture (suggest-and-confirm, Pro) has landed, per the roadmap's
  "Out-of-Scope reconciliation" rule.
- `docs/POST-MVP-ROADMAP.md` — flip the §4 / Delivery-Sequence slot-4 row to shipped and advance the
  "Next up" tracker (to §7 Budget Rollover, slot 5).

**Unchanged but reused:** `src/lib/ai/{client,respond,run,errors,category}.ts`, `src/lib/db/ai.ts`
(`getAiProfile`), `src/lib/db/categories.ts` (`getUserCategories`), `src/lib/analytics/track.ts`,
`src/lib/system-constants.ts` (`AI_MODEL`, `AI_INPUT_MAX_CHARS`, `AI_TIMEOUT_MS`, `RATE_LIMITS`),
`src/app/globals.css` (`--color-ai`). **No schema change. No new migration. No new constant.**

---

## 9. Testing

Per [coding-standards.md](../coding-standards.md) — cover `src/actions/**` + `src/lib/**`, mock the
provider at the module boundary, **no live calls**; components are out of scope. The split (orchestrator
already tested in §3 vs. this feature vs. pure helpers) keeps each layer isolated:

- **`parseDraftJson`** — wrapped object, defensive coercion of every field, malformed JSON →
  `AiParseError`, `amount: null` returned (not thrown), case/whitespace normalization, `EXPENSE`
  default.
- **`resolveDraftDate`** — valid `YYYY-MM-DD` passthrough; empty / malformed / wrong-shape → today.
- **`parseTransaction`** — matched draft (with `promptVersion`) on a well-formed mock; amount-missing →
  `success: false, reason: "no_match"`; unmatched category → `categoryId: null` but still
  `success: true`; over-long `text` truncated to `AI_INPUT_MAX_CHARS` before the call (assert the arg
  passed to the mocked `aiJsonRespond`); empty input rejected by the schema.
- The `runAiFeature` envelope (Pro gate, rate/cap, timeout→reason, single `ai_result`, fail-open) is
  **already covered** by `test/lib/ai/run.test.ts` from §3 — not re-tested here; this slice only asserts
  it is *invoked* with the right `feature` / `burstLimit` / `promptVersion`.

Gates: `npm run test:run` + `npm run build` + lint clean before commit, per
[ai-interaction.md](../ai-interaction.md).

---

## 10. Open questions for the product owner

The roadmap §4 open decisions; the spec proposes answers and flags what needs sign-off:

1. **Entry surface (D1)** — confirm the in-drawer Quick add field for v1 (recommended) vs. a dedicated
   quick-add bar on Dashboard/Transactions now.
2. **Multi-transaction input (D5)** — confirm single-transaction v1; multi-line ("groceries 40 and gas
   30") deferred to the extension point.
3. **Acceptance threshold** — sign off the expand/iterate/retire number for "% confirmed without heavy
   edits" (roadmap starting rubric: ≥60% / 30–60% / <30%) so the spec commits to a target before build.
   Note this feature's natural metric is **confirm-without-edit**, not category-accept.
4. **Account on parse (D4)** — confirm the parse should *not* set the account (keeps topbar-scope
   default), or whether a confidently-named account ("from cash") should be matched in a later iteration.
5. **Same cost rails** — confirm reusing `aiSuggest` (20/h, own bucket) + the shared `aiMonthly` COGS
   cap with no new policy entry (§5.3), consistent with §3.
6. **Autofocus (D10)** — confirm autofocusing the Quick add field on desktop create-open (recommended
   for the capture flow), or prefer no autofocus so manual entry stays the unbiased default.

---

## 11. Alignment checks & extension points

**Alignment:**
- **Confirm-not-auto:** parse returns a draft only; `createTransaction` stays the sole writer. ✅
- **Pro gate DB-driven, never JWT; fail-open on every error/timeout/over-cap → manual entry.** ✅
  (inherited from `runAiFeature`, not re-implemented).
- **Foundation reuse = "prompt + parse step only":** no new client, orchestrator, Pro read, rate policy,
  telemetry sink, or color — this slice is the first concrete proof of §3's D6. ✅
- **Measurable iteration:** prompt is versioned + changelogged; every event carries `prompt_version` and
  a first-class `reason`, so a reword is A/B-comparable and low acceptance is diagnosable
  (`parse_failed` vs `no_match` vs `timeout`). ✅
- **Constants discipline:** model, caps, timeout, input cap, prompt version, AI color all already live in
  `system-constants.ts` / the prompt module / `globals.css` — no magic values in the drawer or action. ✅

**Extension points (intended, not built this slice):**
- **Dedicated quick-add bar** — to surface NL capture outside the drawer, extend
  `useAppShell().openDrawer` to accept an optional `prefill: ParsedTransactionDraft` and have the bar
  call `parseTransaction` then `openDrawer({ prefill })`. The drawer already centralizes the form state,
  so this is additive. Gate on §0 showing NL adoption (and it's the amplifier §14 Mobile/PWA wants).
- **Multi-transaction parse** — change the prompt to return an array and let the drawer iterate
  (confirm-each, or a lightweight review list). The `run` step would return `ParsedTransactionDraft[]`;
  `AiNoMatchError` only when *zero* lines have an amount. Strictly later, evidence-gated.
- **Account resolution** — match a confidently-named account ("cash", "amex") server-side, like
  `matchCategoryByName`, behind the same null-degrade rule (D4). Later iteration.
