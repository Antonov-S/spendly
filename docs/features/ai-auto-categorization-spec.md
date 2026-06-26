# AI Auto-Categorization (Pro) + AI Foundation — Implementation Spec

> **Status: Not started.** This spec implements [POST-MVP-ROADMAP.md](../POST-MVP-ROADMAP.md) §3
> (Delivery Sequence slot 3) — the first AI feature, which also stands up the shared `src/lib/ai/`
> foundation reused by §4 (NL Quick Capture), §5–§6 (insight assistants), and §10 v2 (subscription
> detection). It carries over the OpenAI/`gpt-5-nano` integration learnings from
> [ai-auto-tag-spec.md](../ai-auto-tag-spec.md) (a copy from a sibling project on the same stack) and
> follows the lazy-singleton / rate-limit / Pro-gate patterns already shipped for Stripe and Reports.

> **Goal:** When a **Pro** user is entering an expense/income in the transaction drawer, an LLM
> suggests the most likely **category** from that user's available categories (and optionally a
> cleaned-up **merchant** string) based on the merchant/note/amount text. The suggestion is
> **pre-selected for the user to confirm or override — never written silently.** This keeps the
> conscious-capture moment intact while removing the "which bucket?" hesitation. Free users get the
> normal manual picker with no AI call.

---

## 1. Why this slice

Auto-categorization is the first substantial AI value for Pro (beyond Reports history) and the
**lowest-risk AI feature to build the foundation on**: it has a constrained output space (pick one of
the user's existing categories), an obvious success metric (acceptance rate), and a clean fail-open
path (the manual picker is always right there). Per the roadmap's guiding lens, this is **on-thesis**
— it *suggests and lets the user confirm*, exactly like recurring drafts. The Out-of-Scope entry for
"automatic categorization" referred to **silent** auto-tagging, which we are explicitly **not** doing.

This slice deliberately over-invests in the `src/lib/ai/` boundary so §4–§6 and §10 inherit the
client, the Pro gate, the rate-limit + cost-cap controls, the fail-open contract, and the telemetry
seam for free.

---

## 2. Scope

### In scope

- **`src/lib/ai/` foundation** — a lazy, server-only OpenAI client (mirrors `src/lib/stripe.ts`), an
  `AI_MODEL` config knob defaulting to `gpt-5-nano`, and a thin typed wrapper around the **Responses
  API** (see §4 — `gpt-5-nano` returns empty content on Chat Completions).
- **`runAiFeature()` orchestrator** (`src/lib/ai/run.ts`) — the single place that centralizes the
  cross-cutting concerns **every** AI feature (§3–§6, §10 v2) shares: auth → DB-driven Pro gate → rate
  limit + monthly cost cap → per-call timeout → enriched telemetry → fail-open. Feature actions become
  thin: they supply a prompt + a parse/match step and inherit all of the above (§3.4).
- **`suggestCategory` server action** (`src/actions/ai/suggest-category.ts`) — a thin wrapper over
  `runAiFeature` that supplies the categorization prompt and the parse/match step. Returns a *suggestion
  object*, never writes.
- **Rate-limit + cost-cap config** — extend `RATE_LIMITS` with an `aiSuggest` per-hour budget and add a
  per-user **monthly** call cap (cost ceiling). Fail open to manual on any error/timeout/over-cap.
- **Versioned prompts + outcome telemetry** — each prompt carries a `PROMPT_VERSION`; telemetry records
  the outcome **and a failure reason** (`no_match` / `parse_failed` / `timeout` / …) tagged with that
  version, so a future prompt iteration is measurable against acceptance rate without code archaeology (§9).
- **Transaction-drawer UI** — a Pro-only **"Suggest"** button (Sparkles icon, light-blue AI accent)
  beside the Category field. On click it calls the action, pre-selects the returned category, and (when
  offered) shows a one-tap merchant-cleanup chip. Hidden entirely for Free users.
- **AI accent color** — a documented light-blue palette token (`--color-ai`) reserved for AI
  affordances, the one explicit exception to the strictly-semantic color rule (§7).
- **Telemetry seam** — emit `ai_category_suggested` / `ai_category_accepted` / `ai_category_overridden`
  through a thin no-op-safe `track()` shim so acceptance rate is measurable the day §0 lands.
- **`.env.example`** — `OPENAI_API_KEY` is **already present** (line 36); add the `AI_MODEL` knob and
  document it. Add the `openai` dependency.
- **Vitest** — unit tests for `suggestCategory` (Pro gate, rate/cap, fail-open, output parsing, category
  matching) and the pure parse/match helpers. Mock OpenAI at the module boundary (like Stripe/Resend).

### Out of scope

- §4 Natural-Language Quick Capture (separate slice; reuses this foundation).
- The §0 telemetry **sink** itself — this slice only emits through a shim that no-ops until §0 lands.
- Debounced "suggest as you type" (rejected — see §6, decision D2).
- Persisting suggestions for later subscription-detection reuse (§10) — deferred; not logged.
- Any change to the write path. `createTransaction` / `updateTransaction` remain the only writers.
- A `/settings` "AI" section (usage/limits/toggle) — open question #6 on the roadmap; not this slice.

---

## 3. The AI foundation — `src/lib/ai/`

### 3.1 Client — `src/lib/ai/client.ts`

Mirror the Stripe lazy-singleton exactly (build on first use, throw only when called — never at import,
so the build and non-AI routes never fail when the key is absent):

```ts
import "server-only";
import OpenAI from "openai";

let client: OpenAI | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set — required for AI features.`);
  return value;
}

export function getOpenAI(): OpenAI {
  if (client) return client;
  client = new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });
  return client;
}
```

### 3.2 Config — `AI_MODEL`

`AI_MODEL` is a **config knob** so the model is swappable without touching call sites (the roadmap's
"provider behind an interface" requirement). Default to the cheap, reliable `gpt-5-nano`. Add to
`system-constants.ts`:

```ts
/** OpenAI model for all AI features. Cheap + reliable; overridable via env. */
export const AI_MODEL = process.env.AI_MODEL || "gpt-5-nano";
```

### 3.3 Typed call wrapper — `src/lib/ai/respond.ts`

A single helper that all AI features call, so the Responses-API gotchas live in one place:

```ts
import "server-only";
import { getOpenAI } from "@/lib/ai/client";
import { AI_MODEL } from "@/lib/system-constants";

/** Run one JSON-object Responses-API call and return the raw output_text. */
export async function aiJsonRespond(args: {
  instructions: string;
  input: string;
  signal?: AbortSignal;
}): Promise<string> {
  const response = await getOpenAI().responses.create(
    {
      model: AI_MODEL,
      instructions: args.instructions,
      input: args.input,
      text: { format: { type: "json_object" } },
    },
    { signal: args.signal }
  );
  return response.output_text;
}
```

### 3.4 Orchestrator — `src/lib/ai/run.ts` (the reuse spine)

Every AI feature repeats the same envelope: authenticate, gate on Pro, consume rate budgets, run under
a timeout, emit telemetry, and **fail open**. Centralizing it here means §4–§6 and §10 v2 add a feature
by writing *only* their prompt + parse step — the policy lives in one audited place and can't drift.

```ts
import "server-only";
import { auth } from "@/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { getAiProfile } from "@/lib/db/ai"; // { isPro } DB read (getReportProfile sibling)
import { track } from "@/lib/analytics/track";
import { AiNoMatchError, AiParseError } from "@/lib/ai/errors";
import { AI_TIMEOUT_MS, type RateLimitName } from "@/lib/system-constants";

export type AiFailureReason =
  | "unauthenticated"
  | "not_pro"
  | "rate_limited"
  | "timeout"
  | "ai_error"      // SDK threw / network / unknown
  | "parse_failed"  // model output unparseable
  | "no_match";     // parsed, but matched nothing usable

export type AiResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; reason: AiFailureReason };

interface RunAiFeatureArgs<T> {
  /** Stable feature id — telemetry tag + per-feature burst-limit key prefix (e.g. "category_suggest"). */
  feature: string;
  /** Prompt version emitted in telemetry so iterations are measurable (§9). */
  promptVersion: number;
  /** Per-feature burst budget, keyed `${feature}:${userId}` (e.g. "aiSuggest"). */
  burstLimit: RateLimitName;
  /** Friendly message shown to the user when this feature fails open. */
  failOpenMessage: string;
  /** Feature-specific work. Receives the authed userId + an AbortSignal. */
  run: (ctx: { userId: string; signal: AbortSignal }) => Promise<T>;
}

export async function runAiFeature<T>(args: RunAiFeatureArgs<T>): Promise<AiResult<T>> {
  // 1. auth → 2. Pro gate (DB)
  // → 3a. GLOBAL monthly cost cap: checkRateLimit("aiMonthly", userId)   — keyed by userId ONLY,
  //       so all AI features share one per-user monthly ceiling (§8).
  // → 3b. per-feature burst cap: checkRateLimit(args.burstLimit, `${args.feature}:${userId}`).
  //       Either exhausted → reason: "rate_limited".
  // → 4. run() under an AbortSignal timeout (AI_TIMEOUT_MS)
  // → 5. map thrown AiParseError/AiNoMatchError/AbortError → the right reason
  // → 6. emit one `ai_result` telemetry event { feature, prompt_version, outcome, reason }
  // → 7. return AiResult; never throws to the caller (fail-open).
  …
}
```

Notes:

- **The monthly cap is global per user, not per feature.** `aiMonthly` is always checked here keyed by
  `userId` alone, so it is the **single shared cost ceiling** across §3–§6 / §10 v2 — a user who burns
  the month on auto-categorization has correspondingly less headroom for NL capture, which is the point
  (the budget is COGS-per-Pro-user, §8). The per-feature `burstLimit` is the only knob a feature picks.
- **Reasons are first-class.** `run()` throws `AiParseError` / `AiNoMatchError` to signal the precise
  failure; `runAiFeature` maps those (and `AbortError` → `timeout`, any other throw → `ai_error`) to a
  `reason` that lands in both the result and telemetry. The two sentinel classes live in
  `src/lib/ai/errors.ts` so they are importable without the SDK.
- **`getAiProfile(userId)`** is the AI-layer's `{ isPro }` DB read — a near-clone of `getReportProfile`,
  kept in `src/lib/db/ai.ts` so the AI surface owns its own fetcher (no cross-import into Reports).
- **One telemetry call, always.** Success *and* every failure reason emit exactly one `ai_result` event
  (§9), so acceptance/abandonment is computable without instrumenting each call site.

---

## 4. CRITICAL — `gpt-5-nano` + OpenAI SDK gotchas

Carried verbatim from [ai-auto-tag-spec.md](../ai-auto-tag-spec.md) §"CRITICAL" — these are load-bearing:

- **Use the Responses API, NOT Chat Completions.** `gpt-5-nano` returns **empty content** from
  `client.chat.completions.create()`. You MUST use `client.responses.create()`.

  | Chat Completions (WRONG) | Responses API (CORRECT) |
  |---|---|
  | `client.chat.completions.create()` | `client.responses.create()` |
  | `messages: [{ role, content }]` | `instructions` (system) + `input` (user) |
  | `response_format: { type: 'json_object' }` | `text: { format: { type: 'json_object' } }` |
  | `completion.choices[0].message.content` | `response.output_text` |
  | `max_tokens` | not needed (or `max_output_tokens`) |

- `max_tokens` is **not supported** by `gpt-5-nano`.
- **Do NOT use `zodResponseFormat` / structured output** — it consumes excessive tokens with this model
  and hits length limits. Use `json_object` format and **parse manually**.
- The model may return the wrapped shape **or** a bare value — handle both (§5.3).
- **Normalize strings** (lowercase, trim) after receiving them.

---

## 5. The `suggestCategory` server action

### 5.1 Signature & contract

`src/actions/ai/suggest-category.ts` (`"use server"`). The action is **thin** — it delegates the whole
envelope (auth, Pro gate, rate/cap, timeout, telemetry, fail-open) to `runAiFeature` (§3.4) and supplies
only the categorization-specific prompt + parse/match step:

```ts
export interface CategorySuggestion {
  categoryId: string | null;     // matched to one of the user's categories, or null
  categoryName: string | null;   // resolved name for display
  confidence: "high" | "low";    // drives UI emphasis; see D3
  merchant: string | null;       // cleaned merchant, only when materially better
  promptVersion: number;         // echoed so accept/override telemetry tags the right version (§9)
}

// AiResult<T> is the shared shape from runAiFeature: { success, data } |
// { success: false, error, reason }. The action exposes it unchanged.
export type SuggestResult = AiResult<CategorySuggestion>;

export async function suggestCategory(input: {
  type: "INCOME" | "EXPENSE"; // never TRANSFER — transfers have no category
  merchant?: string | null;
  note?: string | null;
  amount?: number | null;
}): Promise<SuggestResult>;
```

The action **returns a suggestion only** — it never touches the ledger. The existing
`createTransaction` / `updateTransaction` actions remain the sole writers (the roadmap's
"confirm-not-auto, no new write path" contract).

### 5.2 Control flow

The action validates its input (§5.4, reject `TRANSFER`) and then calls:

```ts
return runAiFeature({
  feature: "category_suggest",
  promptVersion: CATEGORY_PROMPT_VERSION,
  burstLimit: "aiSuggest", // the global aiMonthly cap is applied by runAiFeature itself
  failOpenMessage: "Couldn't suggest a category — pick one manually.",
  run: async ({ userId, signal }) => {
    const categories = await getSuggestableCategories(userId);   // system + own
    const raw = await aiJsonRespond({ instructions, input, signal });
    const parsed = parseSuggestionJson(raw);                     // throws AiParseError
    const match = matchCategoryByName(parsed.category, categories); // throws AiNoMatchError? see below
    return { …suggestion, promptVersion: CATEGORY_PROMPT_VERSION };
  },
});
```

Everything outside `run` — the auth/Pro/rate/timeout/telemetry/fail-open envelope — is handled by
`runAiFeature`, so this and every later AI action stay uniform. The roadmap's policy guarantees (Pro
read **fresh from the DB, never the JWT**; **both** `aiSuggest` and `aiMonthly` budgets consumed; **any**
throw/timeout → fail open to the manual picker) are enforced once, in §3.4, not re-implemented per
feature.

> **`no_match` is not a hard failure for *this* feature.** A confident-but-unmatched name should
> degrade to `categoryId: null` (manual picker, still a usable suggestion object) rather than throw —
> so `run` returns a null-category suggestion and lets `runAiFeature` tag the telemetry `reason:
> "no_match"` via the returned data, *not* by throwing. Reserve `AiNoMatchError` for features where an
> empty result is genuinely useless (e.g. §4 NL-parse with no parseable amount).

### 5.3 Prompt & matching

The prompt is **versioned**: a `CATEGORY_PROMPT_VERSION` constant (start at `1`) lives beside the prompt
text in `src/lib/ai/prompts/category.ts`. Bump it whenever the wording changes; §9 telemetry tags every
outcome with it, so a reworded prompt's acceptance rate is directly comparable to the prior version's.

The output space is **constrained** (unlike the freeform-tags sibling): we pass the user's candidate
categories and require the model to pick one **by name**. Matching back to an id happens server-side:

- Fetch the user's selectable categories once (`getDrawerFormData`-style: system + own, the same list
  the picker shows). Pass them as a name list in `input`.
- `instructions`: "You categorize a personal-finance transaction. Choose the single best category
  **from the provided list only**. Respond as JSON `{ \"category\": <name>, \"confidence\": \"high\"|\"low\",
  \"merchant\": <cleaned merchant or null> }`. Use null/low when unsure. Do not invent categories."
- `input`: the candidate names + the transaction's `type`, `merchant`, `note`, `amount`.
- **Parse defensively** — accept `{ "category": "..." }`, a bare `"..."`, or `{ "tags": [...] }`-style
  noise; lowercase + trim; then **case-insensitively match** the returned name to a candidate id. No
  match → `categoryId: null` (fail open to manual; never guess an id).
- **Merchant cleanup** is conservative: only return a non-null `merchant` when it is a materially
  cleaner version of the input (`"AMZN MKTP US*2H..."` → `"Amazon"`); otherwise `null`. The UI offers
  it as a separate one-tap chip — accepting the category does not silently rewrite the merchant.

Pure helpers (`parseSuggestionJson`, `matchCategoryByName`) live in `src/lib/ai/category.ts` so they
are unit-testable without the SDK.

### 5.4 Validation — `src/lib/validations/ai.ts`

```ts
export const suggestCategorySchema = z.object({
  type: z.enum(["INCOME", "EXPENSE"]),
  merchant: z.string().max(AI_INPUT_MAX_CHARS).nullish(),
  note: z.string().max(AI_INPUT_MAX_CHARS).nullish(),
  amount: z.number().finite().nullish(),
});
```

Free-text is truncated to `AI_INPUT_MAX_CHARS` **before** the API call regardless (defense in depth +
token control).

---

## 6. UI integration — transaction drawer

The drawer ([transaction-drawer.tsx](../../src/components/transactions/transaction-drawer.tsx)) gains a
**"Suggest"** affordance beside the Category `<Label>`, only in the non-transfer branch:

- **Pro-only visibility.** `isPro` is not in the drawer today. Thread it in via the existing
  `getDrawerFormData()` payload (add `isPro` to that fetcher's return — one extra `select`, no new
  round-trip) rather than a prop drill. Free users see no button (UI gating), and the action enforces it
  server-side (belt-and-suspenders).
- **Button** — Sparkles icon (`lucide-react`), text "Suggest", **light-blue AI accent** (§7):
  `text-ai` + `hover:bg-ai/10`, ghost style, placed inline-end of the Category label row. Disabled while
  a suggestion is in flight (`useTransition`), showing a small spinner / "Thinking…".
- **On result** — pre-select the returned `categoryId` in `CategoryPickerField` (it already supports a
  controlled `value`/`onChange`); if a `merchant` cleanup is offered, show a dismissible chip under the
  Merchant field ("Use 'Amazon'?") that sets the merchant on tap. **Nothing is saved** — the user still
  presses Save.
- **Low confidence** (D3) — still pre-select, but render the button/field with a subtler "AI guess,
  check it" hint rather than a confident state. The user is always the final arbiter.
- **Errors** — the result's `reason` (§3.4) drives the message: `rate_limited` → "You've hit the hourly
  suggestion limit — pick a category manually."; `not_pro` shouldn't happen (button hidden); every
  fail-open reason (`timeout` / `ai_error` / `parse_failed` / `no_match`) → a quiet toast or inline note,
  **never** a blocked form.
- **Telemetry** — emit `ai_category_accepted` when the user saves with the suggested category unchanged,
  `ai_category_overridden` when they change it before saving — both carrying the `promptVersion` the
  action returned (§9).

**Decisions (decisions over options):**

- **D1 — On-demand button, not auto-on-open.** Explicit click = a deliberate, billable action the user
  asked for; no surprise calls, no cost on every drawer open. On-thesis (conscious capture).
- **D2 — No debounced "suggest as you type."** Rejected: noisy, multiplies cost, and fights the
  conscious-capture frame. One button, one call.
- **D3 — `confidence` is `"high" | "low"`, not a number.** A coarse flag is enough to style the hint and
  is far more robust to parse than a model-emitted float.
- **D4 — Merchant cleanup is opt-in per-suggestion, separate from the category accept.** Accepting a
  category must not silently rewrite a field the user typed.
- **D5 — Prompts are versioned (`CATEGORY_PROMPT_VERSION`), tagged on every telemetry event.** A prompt
  reword is a measurable experiment, not a silent change — acceptance rate is compared per version (§9).
  The constant lives with the prompt text in `src/lib/ai/prompts/category.ts`; bump on any wording edit.
- **D6 — Cross-cutting policy lives once, in `runAiFeature` (§3.4).** Auth, Pro gate, rate/cap, timeout,
  telemetry, and fail-open are not re-implemented per action — §4–§6 / §10 v2 supply only a prompt +
  parse step. Prevents the policy drift that per-action copies invite (e.g. one feature forgetting the
  monthly cap or reading `isPro` off the JWT).

---

## 7. Design system — AI accent color (light blue)

The design system is **strictly semantic** (green/amber/red/grey + `info` blue for links). AI
affordances need a distinct, consistent color that does **not** collide with those meanings — so this
slice introduces **one documented exception**: a light-blue **AI accent**, used *only* for AI buttons
and AI-suggested affordances. It is intentionally lighter/brighter than the existing `info` (`#378ADD`,
reserved for links) so "this is AI" reads at a glance and never looks like a plain link.

Add to the `@theme` block in [globals.css](../../src/app/globals.css):

```css
  /* AI accent — light blue, reserved for AI affordances only (see ai spec §7).
     Distinct from --color-info (#378add, links) on purpose. */
  --color-ai: #5ea8ff;        /* primary AI accent (buttons, icons) */
  --color-ai-strong: #3d8bff; /* hover / active */
```

Usage conventions (Tailwind v4 alpha utilities cover the tints — no extra tokens needed):

- Button text/icon: `text-ai`, hover `text-ai-strong` / `hover:bg-ai/10`.
- Solid AI button (if ever needed): `bg-ai text-white hover:bg-ai-strong`.
- Suggested-field highlight: `ring-ai/40`, `bg-ai/5`.

Document it in `project-overview.md` → **Design System** table as a new row:

| State | Color | Hex |
|---|---|---|
| AI affordance (Pro) | Light blue | `#5EA8FF` |

> The light-blue shades above are the recommendation; if a different tint reads better against the dark
> surfaces in-browser, adjust the two hexes in one place (`globals.css`) — every call site uses the
> token, never a literal.

---

## 8. Cost & abuse controls

The roadmap's AI cost budget is **≤ ~10% of net Pro revenue (~€0.20–0.30 / Pro user / month)**. A
`gpt-5-nano` categorization is a few hundred tokens — a tiny fraction of a cent — so the cap is a
**runaway/abuse rail**, not the expected path.

Add to `RATE_LIMITS` in `system-constants.ts`:

```ts
  // AI feature budgets. Both fail open (no Redis -> allowed).
  //  - aiSuggest: per-FEATURE burst cap, keyed `${feature}:${userId}` — each AI
  //    feature gets its own hourly burst budget (auto-categorize, NL capture, …).
  //  - aiMonthly: ONE GLOBAL per-user monthly cost ceiling, keyed by userId only,
  //    SHARED across every AI feature. This is the COGS rail (§8); runAiFeature
  //    always checks it, regardless of which feature is calling.
  aiSuggest: { limit: 20, window: "1 h" },
  aiMonthly: { limit: 500, window: "30 d" },
```

Plus two scalar knobs in `system-constants.ts`:

```ts
/** Max free-text chars sent to the model per AI call (truncate before sending). */
export const AI_INPUT_MAX_CHARS = 2000;
/** Per-call AI timeout. On timeout the action fails open to the manual picker. */
export const AI_TIMEOUT_MS = 8000;
```

- `aiSuggest` (20/h) is the **per-feature** burst budget (keyed `${feature}:${userId}`) — matches the
  sibling spec's per-user burst, but each AI feature gets its own bucket so one can't starve another.
- `aiMonthly` (500/mo) is **one global per-user ceiling** (keyed by `userId` alone), **shared across all
  AI features** — it's a COGS rail, and COGS is measured per Pro user, not per feature. `runAiFeature`
  applies it on every call; a feature never opts out. ~500 nano calls ≪ €0.30/mo. Calibrate against real
  §0 COGS at the Pro Value Review checkpoint.
- Both are **fail-open** by construction (the existing `checkRateLimit` returns `ALLOW` with no Redis),
  consistent with "the app must never block capture because the limiter is down."

---

## 9. Telemetry seam (§0 not yet built)

§0 (Product Analytics) is a separate, product-owner-gated slice, but §3 must ship **instrumented** so
acceptance rate is measurable from day one. Stand up a **thin, no-op-safe shim** now and let §0 wire the
real sink later:

- `src/lib/analytics/track.ts` — `export async function track(event: string, props?: Record<string,
  string | number | boolean>): Promise<void>` that currently does nothing (or `console.debug` behind a
  flag). **No PII, no financial values** — event names + outcome counters only.
- When §0 lands it swaps the shim's body for the real sink; the call sites here don't change.

**Event taxonomy — two emitters, both version- and reason-tagged:**

| Event | Emitted by | Props |
|---|---|---|
| `ai_result` | `runAiFeature` (server, §3.4) — **always, exactly once** per call | `feature`, `prompt_version`, `outcome` (`"ok"` \| `"fail"`), `reason` (`AiFailureReason` \| `"no_match"` \| `"ok"`) |
| `ai_category_accepted` | drawer on Save, suggested category unchanged | `feature`, `prompt_version` |
| `ai_category_overridden` | drawer on Save, user changed the suggested category | `feature`, `prompt_version` |

- **Failure reasons are first-class** (the orchestrator's `AiFailureReason`): `not_pro`, `rate_limited`,
  `timeout`, `ai_error`, `parse_failed`, `no_match`. This turns "low acceptance" into a *diagnosable*
  signal — a spike in `parse_failed` means the prompt/parse drifted from the model's output; a spike in
  `no_match` means the candidate list or matching is off; `timeout` means tune `AI_TIMEOUT_MS`. Without
  the reason, all three look identical in the funnel.
- **`prompt_version` on every event** — because the action echoes `promptVersion` in its result (§5.1),
  the accept/override events carry the exact version that produced the suggestion. Acceptance rate is
  then sliceable by version, so a prompt iteration is measured against its predecessor (D5) rather than
  silently conflated.
- The expand/iterate/retire rubric (§12, Q2) computes **acceptance rate = `accepted / (accepted +
  overridden)`**, filtered to a single `prompt_version`, with the `reason` breakdown as the "why".

> If the product owner prefers to **not** add even a shim before §0, gate the emits behind a single
> `ANALYTICS_ENABLED` flag defaulting off. Recommendation: ship the shim — it's the cheapest way to
> avoid retrofitting emit sites across §3–§6 later.

---

## 10. Files

**New — foundation (reused by §4–§6, §10 v2)**
- `src/lib/ai/client.ts` — lazy OpenAI singleton (`server-only`).
- `src/lib/ai/respond.ts` — `aiJsonRespond` Responses-API wrapper.
- `src/lib/ai/run.ts` — `runAiFeature` orchestrator (auth / Pro / rate+cap / timeout / telemetry / fail-open).
- `src/lib/ai/errors.ts` — `AiParseError`, `AiNoMatchError` sentinels (no SDK import).
- `src/lib/db/ai.ts` — `getAiProfile(userId)` → `{ isPro }` (AI-layer's own Pro read).
- `src/lib/analytics/track.ts` — no-op telemetry shim.

**New — auto-categorization feature**
- `src/actions/ai/suggest-category.ts` — thin `suggestCategory` action over `runAiFeature`. (Directory
  `src/actions/ai/` so §4–§6 each add their own file rather than growing one god-action.)
- `src/lib/ai/prompts/category.ts` — categorization prompt text + `CATEGORY_PROMPT_VERSION`.
- `src/lib/ai/category.ts` — pure `parseSuggestionJson` + `matchCategoryByName` helpers.
- `src/lib/db/ai.ts` (also above) — `getSuggestableCategories(userId)` (system + own name list).
- `src/lib/validations/ai.ts` — `suggestCategorySchema`.

**New — tests**
- `test/lib/ai/run.test.ts` — orchestrator: Pro gate, rate/cap, timeout→`reason`, fail-open, single
  `ai_result` emit per outcome (mock `auth` / `checkRateLimit` / `getAiProfile` / `track`).
- `test/lib/ai/category.test.ts` — pure parse/match helpers.
- `test/actions/ai/suggest-category.test.ts` — the wired action (mock OpenAI + `runAiFeature` deps).

**Modified**
- `src/lib/system-constants.ts` — `AI_MODEL`, `AI_INPUT_MAX_CHARS`, `AI_TIMEOUT_MS`, `RATE_LIMITS`
  (`aiSuggest`, `aiMonthly`).
- `src/app/globals.css` — `--color-ai`, `--color-ai-strong`.
- `src/components/transactions/transaction-drawer.tsx` — Suggest button + suggestion wiring.
- `src/actions/transactions.ts` — add `isPro` to the `getDrawerFormData` return (one `select`).
- `.env.example` — add `AI_MODEL` knob (the `OPENAI_API_KEY` line already exists).
- `package.json` — add the `openai` dependency.
- `docs/project-overview.md` — Design System table (AI accent row); soften the Out-of-Scope
  "automatic categorization" framing (it graduates here as *suggestions*, per roadmap §"Out-of-Scope
  reconciliation").

**No schema change. No new migration.** (No model stores AI output in this slice.)

---

## 11. Testing

Per [coding-standards.md](../coding-standards.md) — test `src/actions/**` + `src/lib/**`, mock the
provider at the module boundary (like Stripe/Resend), **no live calls**. The split (orchestrator vs.
feature vs. pure helpers) makes each layer testable in isolation:

- `runAiFeature` (the reuse spine): rejects non-auth (`reason: "unauthenticated"`); rejects Free
  (`reason: "not_pro"`); returns `reason: "rate_limited"` when **either** budget is exhausted (mock
  `checkRateLimit`); maps a thrown `AiParseError`→`parse_failed`, `AbortError`→`timeout`, any other
  throw→`ai_error`; **never throws to the caller** (fail-open); emits **exactly one** `ai_result` event
  with `{ feature, prompt_version, outcome, reason }` on every path (mock `track`, assert call count + props).
- `suggestCategory`: rejects `TRANSFER` before calling the model; returns a matched suggestion (with
  `promptVersion`) on a well-formed mock response; degrades to `categoryId: null` + `reason: "no_match"`
  on an unmatched name; truncates over-long input before the call.
- `parseSuggestionJson`: handles `{ "category": "X" }`, bare `"X"`, `{ "tags": [...] }` noise, malformed
  JSON (→ throws `AiParseError`), and whitespace/case normalization.
- `matchCategoryByName`: case-insensitive match, no-match → null, never invents an id.

Gates: `npm run test:run` + `npm run build` + lint clean before commit (per
[ai-interaction.md](../ai-interaction.md) workflow).

---

## 12. Open questions for the product owner

These are the roadmap §3 open decisions; the spec proposes answers but flags what needs sign-off:

1. **Model + cost cap numbers** — `gpt-5-nano` is chosen (your stated preference). Confirm the
   `aiSuggest` 20/h **per-feature** burst cap and the `aiMonthly` 500/mo **global** per-user ceiling
   (one shared cap across all AI features — decided), or set your own against the ~€0.20–0.30/Pro/mo COGS.
2. **Acceptance thresholds** — sign off the expand/iterate/retire rubric for this feature (roadmap
   starting point: ≥60% accept = expand, 30–60% = iterate, <30% = retire) so the spec commits to a number.
3. **Telemetry shim** — OK to add the no-op `track()` shim now (recommended), or gate emits behind an
   off-by-default flag until §0 ships?
4. **Merchant cleanup aggressiveness** — confirm conservative (only obviously-messy merchants), opt-in
   per suggestion (D4).
5. **Settings AI section** — out of scope here (roadmap open question #6); confirm deferral.

---

## 13. Alignment checks

- **Confirm-not-auto:** suggestion object only; `createTransaction`/`updateTransaction` stay the sole
  writers. ✅ on-thesis.
- **Pro gate is DB-driven, never JWT** — reuses the `getReportProfile` pattern. ✅ matches Reports/Stripe.
- **Fail open** on every error/timeout/over-cap → manual picker. ✅ capture never blocked.
- **Foundation reuse:** `src/lib/ai/` (client + respond + **`runAiFeature`**), the Pro gate,
  `RATE_LIMITS` entries, and the telemetry shim are all consumed unchanged by §4–§6 / §10 v2 — each new
  feature supplies only a prompt + parse step (D6). ✅
- **Policy lives once:** auth / Pro / rate+cap / timeout / fail-open / telemetry are centralized in
  `runAiFeature`, so a later feature can't silently skip the monthly cap or read `isPro` off the JWT. ✅
- **Measurable iteration:** prompts are versioned (D5) and every telemetry event carries
  `prompt_version` + a first-class failure `reason`, so prompt reworks are A/B-comparable and low
  acceptance is diagnosable (`parse_failed` vs `no_match` vs `timeout`), not a black box. ✅
- **Constants discipline:** no magic values in components/actions — model, caps, timeout, input cap,
  prompt version, and the AI color all live in `system-constants.ts` / the prompt module / `globals.css`. ✅

---

## 14. Extension points (intended, not built this slice)

Recorded so the next AI slice (§4–§6 / §10 v2) inherits the intent rather than rediscovering it. None of
these is implemented here; they are the deliberate seams `runAiFeature` + the prompt module leave open.

- **Prompt evolution is documented, not just versioned.** Beyond bumping `CATEGORY_PROMPT_VERSION`, keep
  a short changelog comment block at the top of each `src/lib/ai/prompts/*.ts` — one line per version
  (`v2 — added amount band to input; v1 — initial`). The number is the telemetry join key (§9); the
  changelog is the human "what changed and why", so a regression in acceptance rate after a bump is
  traceable to a specific wording edit without git archaeology.
- **Telemetry props stay an open record.** `track(event, props)` takes `Record<string, string | number |
  boolean>` precisely so a later feature can add keys (e.g. `model`, `latency_ms`, `token_estimate`,
  `candidate_count`) without a schema migration or touching existing emit sites. New features **add**
  props; they never repurpose `feature` / `prompt_version` / `reason`, which the rubric depends on.
- **`runAiFeature` stays the single seam for cross-cutting behaviour.** Anything that should apply to
  *all* AI calls — observability (latency/token logging), a future **retry/back-off** policy, a circuit
  breaker, model A/B routing, a per-user kill switch — belongs **inside** the orchestrator, never copied
  into a feature action. A feature action must remain "prompt + parse step" only (D6).
  - **Retries are intentionally NOT in v1.** Fail-open to the manual picker is faster and cheaper than a
    retry, and capture is never blocked, so a single attempt is correct for an interactive suggestion. If
    a *non-interactive* AI feature later needs retries (e.g. a batched §10 subscription-detection run),
    add a `retries`/`backoff` option to `RunAiFeatureArgs` and implement it once in `runAiFeature` —
    behind a default of `0` so the interactive features are unaffected.
- **Provider portability.** The model is already a config knob (`AI_MODEL`); if a second provider is ever
  benchmarked (Claude Haiku, per the roadmap), the swap surface is `src/lib/ai/client.ts` +
  `src/lib/ai/respond.ts` only — call sites and `runAiFeature` are provider-agnostic by construction.
