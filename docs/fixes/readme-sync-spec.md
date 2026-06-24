# Fix Spec: Sync README with Shipped State

The root [`README.md`](../../README.md) was generated when most of the product surface was
unbuilt. Since then the entire MVP shipped (ROADMAP §0–§9, all ✅). The README now
**understates** the project — listing shipped features as "in progress" and unchecked, and
referencing env vars that were removed. This is a documentation-only sync; no code changes.

Branch: `docs/readme-sync`

Source of truth: [docs/ROADMAP.md](../ROADMAP.md) "Completed" table + Delivery Sequence (all
9 ✅) and [docs/project-overview.md](../project-overview.md) (the ✅ Shipped callouts). Where
the repo and the spec disagree, **the repo/ROADMAP wins** (same rule the original README
followed).

---

## What's stale (and the correction)

### 1. Project Status section ([README.md:11-34](../../README.md#L11-L34))

- **"In progress" list** names Reports, Data export, and Stripe billing — **all three are
  shipped**. Remove the "In progress" block (or repoint it at genuinely-unbuilt post-MVP
  work, not these).
- **"Shipped" list** is missing: Reports, Data export (CSV/JSON), Settings page, Stripe Pro
  billing, User category management, Onboarding/first-run gate, Dashboard insights strip,
  and the pre-launch polish (error/404 pages, page titles). Add them.
- The framing "the transactional product surface is being built" is now wrong — the MVP loop
  is complete (capture → organize → control → understand). Reframe to "MVP complete;
  launch-prep / operator tasks remain" per ROADMAP §9's "Operator launch-day tasks remain."

### 2. Features section ([README.md:49-66](../../README.md#L49-L66))

- The Reports bullet says "(planned)"-style framing via the status note; it is live (four
  SVG charts, period selector, Free 3-month / Pro 12-month gate). State it as shipped.
- Add a **Settings** bullet (`/settings`: display-name, billing, data export, manage
  categories) and a **User categories** bullet (create/edit/delete own categories).
- The closing status caveat ([README.md:66](../../README.md#L66)) can be softened — "varies
  by feature" no longer applies broadly; the MVP is built.

### 3. Tech Stack ([README.md:99-106](../../README.md#L99-L106))

- Stripe row says **"Subscription billing (planned)"** — it's **shipped** (`stripe@^22.x`,
  webhook + checkout + portal). Update the note and add the real version (read from
  `package.json`, do not guess).

### 4. Environment Variables ([README.md:172-204](../../README.md#L172-L204))

Reconcile with the **actual** [`.env.example`](../../.env.example) — two known drifts:

- **`OPENAI_API_KEY`** ([README.md:202-203](../../README.md#L202-L203)) was removed from
  `.env.example` in pre-launch polish (§9) — it is read nowhere in source. Remove it from the
  README.
- **`STRIPE_PUBLISHABLE_KEY`** ([README.md:197](../../README.md#L197)) was dropped in the
  Stripe slice (server-only integration, no browser Stripe.js). Remove it.
- Verify every remaining listed var exists in `.env.example` and vice-versa — the README block
  should mirror the file exactly.

### 5. Project Structure ([README.md:248-269](../../README.md#L248-L269))

- `actions/` comment says "(auth, profile)" — there are now many more
  (`transactions`, `budgets`, `recurring`, `goals`, `categories`, `financial-accounts`,
  `billing`, …). Generalize the description.
- `components/` lists "(auth, dashboard, marketing, profile, ui)" — add the feature folders
  that now exist (`budgets`, `goals`, `recurring`, `transactions`, `settings`, `categories`,
  `layout`, `reports`, `onboarding`, …). Verify against the real tree before writing.
- `app/` note "auth flows live under app/api/auth/*" should also mention the non-auth API
  routes that now exist: `app/api/export/*` and `app/api/stripe/webhook`.

### 6. Roadmap checklist ([README.md:317-338](../../README.md#L317-L338))

Flip these from `[ ]` to `[x]` (all shipped):

- Reports & analytics
- Data export (CSV / JSON)
- Stripe Pro billing

Add (if not present) shipped items: Settings page, User category management, Onboarding /
first-run gate, Dashboard insights strip, Pre-launch polish (error boundary, 404, page
titles). The four genuinely post-MVP items (auto-categorization, subscription detection,
bank sync, cross-currency, native mobile) stay unchecked under a clearly-labelled post-MVP
group.

### 7. Deployment checklist ([README.md:306-313](../../README.md#L306-L313))

Optionally align with ROADMAP §9's remaining operator tasks (Stripe **live** keys + webhook +
portal, Google prod OAuth callback, backup/rollback, observability) — keep it short; this is
a README, not the launch runbook.

---

## Guardrails

- **Derive every fact from the repo**, not from memory: versions from `package.json`, env
  vars from `.env.example`, folders from the real `src/` tree, feature status from ROADMAP's
  Completed table. The original README's discipline ("repo wins over spec") holds.
- **Keep the existing voice, section order, and Mermaid diagram.** This is a sync, not a
  rewrite — change only what is factually stale.
- **EUR, not USD/`$`.** The app is EUR-only and `formatCurrency` renders `€`; make sure no
  README copy implies dollars.
- Note the README still says shadcn/ui is omitted (hand-rolled `cn()`); that remains true —
  do not "correct" it back to claiming shadcn even though `project-overview.md`'s tech-stack
  table lists it. Repo wins.

## Testing

Documentation only — no Vitest, no build impact. Verification is a read-through:

1. Every checklist item's status matches ROADMAP.md.
2. Env var block matches `.env.example` exactly (no `OPENAI_API_KEY`, no
   `STRIPE_PUBLISHABLE_KEY`).
3. No remaining "planned" / "in progress" label on a shipped feature (Reports, Export,
   Stripe, Settings, Categories).
4. Links and the Mermaid block still render.
