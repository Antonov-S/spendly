# Fix Spec: Auth Card Layout + Scroll-Behavior Warning

Two small, unrelated markup/styling fixes batched into one slice (no shared logic, both
trivial, neither has a unit-test surface).

Branch: `fix/auth-layout-polish`

---

## Issue 1 — Logo sits outside the auth card; heading not centered

### Current behaviour

`AuthCard` (shared by `/sign-in` and `/register`) renders the `<Logo>` wordmark **above**
the card and left-aligns the heading/subtitle inside it —
[auth-card.tsx:13-24](../../src/components/auth/auth-card.tsx#L13-L24):

```tsx
<div className="mb-8 flex justify-center">
  <Logo />
</div>

<div className="rounded-xl border border-line bg-surface p-6">
  <h1 className="text-[18px] font-medium text-ink">{title}</h1>
  <p className="mt-1 text-[12px] text-ink-2">{subtitle}</p>
  …
```

### Desired behaviour

- **Remove** the standalone Logo block above the card (the "logo + Spendly name outside the
  auth card").
- **Center** the heading region — the title (e.g. "Welcome back") and subtitle (e.g. "Sign
  in to your Spendly account") — inside the card.

### Fix

In [auth-card.tsx](../../src/components/auth/auth-card.tsx):

- Delete the `<div className="mb-8 flex justify-center"><Logo /></div>` block and the now-
  unused `import { Logo }` line.
- Add `text-center` to the heading wrapper so the `<h1>` + subtitle `<p>` center. Either add
  it to each (`<h1 … className="… text-center">`) or wrap both in a `<div className="text-center">`.
  Leave the `children` (the form) and `footer` as they are — only the title/subtitle block
  centers.

> This is a shared component, so both `/sign-in` and `/register` are fixed at once. Both pass
> `title` + `subtitle` props; no page-level change is required. Verify the `forgot-password`
> and `reset-password` pages — if they also use `AuthCard`, confirm the centered, logo-less
> look reads correctly there too (it should; same pattern).

---

## Issue 2 — `scroll-behavior: smooth` route-transition warning

### Current behaviour

The browser console logs:

> Detected `scroll-behavior: smooth` on the `<html>` element. To disable smooth scrolling
> during route transitions, add `data-scroll-behavior="smooth"` to your `<html>` element.

Next.js wants the attribute present so it can suppress smooth scrolling during route
transitions (which otherwise causes janky animated jumps on navigation) while keeping smooth
scrolling for in-page anchor links.

### Fix

Add `data-scroll-behavior="smooth"` to the `<html>` element in the root layout
([src/app/layout.tsx](../../src/app/layout.tsx)):

```tsx
<html lang="en" data-scroll-behavior="smooth" …>
```

Keep the existing `scroll-behavior: smooth` CSS (used by the marketing page's anchor links,
e.g. the hero/features `#` jumps) — the attribute is what silences the warning and fixes the
route-transition behaviour, not removing the CSS.

> Confirm `<html>` lives in `src/app/layout.tsx` and note any existing attributes/className
> (e.g. a font variable or `lang`) so the new attribute is added alongside, not replacing them.

---

## What we are not doing

- **Not** removing the `scroll-behavior: smooth` rule from `globals.css` (anchor-link smooth
  scroll on the landing page is intended).
- **Not** restyling the auth forms, buttons, or card border — only the Logo removal +
  heading centering.
- **Not** relocating the Logo elsewhere — the brand is already present via the page itself;
  the card no longer needs it.

## Testing

### Unit (Vitest)

None — both changes are markup only, no `src/actions` or `src/lib` logic. Existing suites
must stay green (`npm run test:run`).

### Build / lint

`npm run build` + `npm run lint` (ESLint `no-unused-vars` confirms the `Logo` import was
removed).

### Manual

1. `/sign-in` — no logo/wordmark above the card; "Welcome back" + subtitle are centered
   inside the card; form and footer link unchanged.
2. `/register` — same (logo gone, heading centered).
3. `/forgot-password`, `/reset-password` — render correctly with the shared change.
4. Open DevTools console, navigate between routes — the `scroll-behavior: smooth` warning is
   gone; landing-page anchor links (`#features`, etc.) still scroll smoothly.
