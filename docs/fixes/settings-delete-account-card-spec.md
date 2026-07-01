# Fix Spec: Delete Account as a Data & Privacy Inner Card

The **Delete account** block on `/settings` is visually out of step with the rest of the
**Data & privacy** area. Today Data & privacy is a single `<section>` card containing **two
inner cards** — a green "export before you delete" callout and a blue "import data" callout —
while **Delete account** is rendered as its **own** top-level `<section>` with **no inner card**,
so it reads as a separate, differently-shaped tier rather than as part of the same privacy group.

This fix restyles Delete account to match the Data & privacy inner-card pattern: it becomes a
**third, danger-tinted inner card inside the Data & privacy section**, sitting last after the
export and import cards. Content, copy, and behaviour are unchanged — the confirm dialog, the
email re-type gate, and the `deleteAccount` action all stay exactly as they are.

This is **UI polish only** — no schema change, no migration, no Server Action change, no new
constant, no logic change. Two files touched, markup/classes only.

Branch: `fix/settings-delete-account-card`

---

## Current behaviour

[settings/page.tsx](../../src/app/settings/page.tsx):

- **Data & privacy** is a `<section aria-labelledby="data-privacy-heading">` styled
  `rounded-xl border border-line bg-surface p-6`
  ([settings/page.tsx:180-222](../../src/app/settings/page.tsx#L180-L222)). It contains two
  **inner cards**:
  - Export callout — `rounded-lg border border-success/30 bg-success/10 p-4`
  - Import callout — `rounded-lg border border-info/30 bg-info/10 p-4`
- **Delete account** is rendered *after* Data & privacy as a **sibling top-level section**
  ([settings/page.tsx:224-225](../../src/app/settings/page.tsx#L224-L225)), via
  `<DeleteAccountDialog email={user.email} />`.

[delete-account-dialog.tsx](../../src/components/settings/delete-account-dialog.tsx):

- The component's root is its **own** `<section aria-labelledby="delete-account-heading">` styled
  `rounded-xl border border-danger/30 bg-surface p-6`
  ([delete-account-dialog.tsx:49-53](../../src/components/settings/delete-account-dialog.tsx#L49-L53)),
  holding an `<h2>`, an explanatory `<p>`, the "Delete account" trigger button, and the native
  `<dialog>`.

Result: three distinct card shapes/tiers where there should be one privacy group with a nested
danger action — the danger block looks bolted on rather than belonging to Data & privacy.

---

## Desired behaviour

- **Delete account is an inner card of the Data & privacy section**, visually consistent with the
  export (green) and import (blue) callouts: same `rounded-lg … p-4` inner-card footprint, but
  **danger-tinted** (`border-danger/30 bg-danger/10`) so it still reads as the destructive action.
- It stays **last**, after the export and import cards (preserves the "export first, delete last"
  ordering — the §3 D7 danger-zone-last intent).
- The confirm **dialog**, the typed-email match gate, the `deleteAccount` action, the grace-period
  copy, and the "export from Data & privacy above" reminder inside the dialog are **unchanged**.

---

## Fix

### 1. `delete-account-dialog.tsx` — root `<section>` → inner `<div>` card

Change **only** the component's outer wrapper and heading level so it renders as an inner card
rather than a top-level section. The button, `<dialog>`, and all handlers stay as-is.

- Root element: `<section … className="rounded-xl border border-danger/30 bg-surface p-6">`
  becomes a `<div className="rounded-lg border border-danger/30 bg-danger/10 p-4">` — matching the
  export/import inner cards' `rounded-lg … p-4` footprint, danger-tinted (`bg-danger/10`) to mirror
  the green/blue tinted callouts.
- Keep `aria-labelledby="delete-account-heading"` on the `<div>` wrapper.
- **Heading (decided — do not deviate): keep the semantic `<h2 id="delete-account-heading">`, but
  restyle it to the callouts' lead-in size/weight while retaining the danger color** →
  `className="text-[12px] font-medium text-danger"` (was `text-[13px] font-medium text-danger`).
  This is the one heading style for this card: a real `<h2>` (preserves the accessible name and the
  document outline) that *visually* matches the export/import card lead-ins, with `text-danger`
  kept so the destructive action still reads as destructive. Do **not** demote it to a `<p>`, and
  do **not** leave it at `text-[13px]`.
- The trigger button and dialog markup are **untouched**.

> Heading semantics (rationale): the export/import callouts lead with a plain
> `<p class="text-[12px] font-medium text-ink">`. Delete account intentionally **diverges** here —
> it keeps a real `<h2>` (labelled via `aria-labelledby`) because it is a distinct, destructive
> titled action that benefits from being in the heading outline, and uses `text-danger` instead of
> `text-ink`. The only thing borrowed from the callouts is the `text-[12px] font-medium` **size and
> weight**, so the three cards share a visual lead-in rhythm. Never drop the `<h2>`/accessible
> name, and never leave `aria-labelledby` pointing at a missing id.

Resulting wrapper (illustrative):

```tsx
<div
  aria-labelledby="delete-account-heading"
  role="group"
  className="rounded-lg border border-danger/30 bg-danger/10 p-4"
>
  <h2
    id="delete-account-heading"
    className="text-[12px] font-medium text-danger"
  >
    Delete account
  </h2>
  {/* …unchanged explanatory <p>, trigger button, and <dialog>… */}
</div>
```

### 2. `settings/page.tsx` — move the dialog **inside** the Data & privacy section

Move `<DeleteAccountDialog email={user.email} />` from its current top-level position
([settings/page.tsx:224-225](../../src/app/settings/page.tsx#L224-L225)) to the **end of the
Data & privacy `<section>`**, immediately after the import callout `<div>` (currently closing at
[settings/page.tsx:221](../../src/app/settings/page.tsx#L221)) and before the section's closing
`</section>`. Add the standard `mt-4` inter-card spacing so it sits below the import card with the
same rhythm as the export→import gap.

```tsx
{/* Data & privacy */}
<section
  aria-labelledby="data-privacy-heading"
  className="rounded-xl border border-line bg-surface p-6"
>
  <h2 id="data-privacy-heading" …>Data &amp; privacy</h2>

  {/* export callout (unchanged) */}
  <div className="mt-4 rounded-lg border border-success/30 bg-success/10 p-4">…</div>

  {/* import callout (unchanged) */}
  <div className="mt-4 rounded-lg border border-info/30 bg-info/10 p-4">…</div>

  {/* delete account — now the third, danger-tinted inner card, last */}
  <div className="mt-4">
    <DeleteAccountDialog email={user.email} />
  </div>
</section>
```

(If the component already carries its own top margin, drop the wrapping `mt-4 div` and let the
card space itself — pick whichever keeps the export→import→delete gaps identical. Do not
double-space.)

Remove the now-stale trailing `{/* Danger zone — kept last (§3 D7) */}` top-level comment/placement
([settings/page.tsx:224](../../src/app/settings/page.tsx#L224)); the "kept last" intent is now
satisfied by card order within the section. Optionally re-add a short inline note on the delete
card so the D7 rationale isn't lost.

No prop or import changes: `DeleteAccountDialog` keeps the same `email` prop and import.

---

## What we are not doing

- **Not** changing `deleteAccount`, `DeleteAccountState`, or any Server Action / validation.
- **Not** changing the confirmation `<dialog>`, the typed-email match logic, the grace-period copy
  (`ACCOUNT_DELETION_GRACE_PERIOD_DAYS`), or the in-dialog "export from Data & privacy above"
  reminder.
- **Not** re-ordering export vs import, or changing their styling.
- **Not** merging Delete account into the export callout — it stays a **distinct** danger-tinted
  card, just nested in the same section.
- **Not** adding a schema change, migration, constant, route, or test surface.

---

## Testing

### Unit (Vitest)

None — this is markup/class-only with no new logic surface (per project standards, components are
not unit-tested). Existing suites must stay green (`npm run test:run`).

### Build / lint

`npm run build` and `npm run lint` must pass — ESLint `no-unused-vars` confirms no orphaned
imports/symbols after the wrapper change (e.g. an unused `signOutAction`-style leftover is not
introduced).

### Manual

1. `/settings` → **Data & privacy** now shows **three** inner cards in one section: export (green),
   import (blue), delete account (danger-tinted) — visually the same `rounded-lg … p-4` footprint,
   evenly spaced.
2. There is **no** separate top-level Delete account section below Data & privacy.
3. The "Delete account" trigger still opens the confirm dialog; typing the correct email enables
   the destructive button; a wrong email keeps it disabled; the in-dialog "export from Data &
   privacy above" reminder still reads correctly (export card is in the same section, above).
4. Full delete path still works end-to-end (deactivate → redirect to `/sign-in?deleted=1`).
5. Responsive check at 375 / 768 / 1440px — the three cards stack cleanly with consistent gaps;
   the danger card is legible in dark and light mode.
6. Keyboard/AX: the delete card retains its accessible name (heading), and focus/Tab order into
   the trigger and dialog is unchanged.
