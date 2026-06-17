# Homepage Spec — Full Landing Page

> Build the complete public landing page at `/`, extending the existing animated hero ([homepage-mockup-spec.md](./homepage-mockup-spec.md)) into a full marketing page: nav, hero, features, AI section, pricing, CTA, footer.

## Overview

The hero is already shipped (`src/components/marketing/hero.tsx`, `hero-animation.tsx`, `dashboard-preview.tsx`, with copy + snapshot in `src/lib/marketing/`). This spec adds the remaining landing sections **below** the hero and a fixed top navigation **above** it, assembling them into one cohesive page at `/`.

Success looks like:

- A complete, on-brand marketing page (dark mode, semantic palette) that loads fast and reads top-to-bottom: Nav → Hero → Features → AI → Pricing → CTA → Footer.
- Every link and button points to a real destination — no dead buttons (principle #6, "never UI without backing function").
- Authenticated visitors hitting `/` still redirect to `/dashboard` (existing `redirectIfAuthenticated()` behavior is preserved).
- Sections are independent, server-rendered components; only genuinely interactive pieces (`'use client'`) opt into client rendering.

## Scope

- Route: `/` — extend the existing `src/app/page.tsx`, do **not** rewrite the hero.
- Marketing only. No new backend, no Stripe checkout wiring — pricing CTAs link to `/register` (checkout is a separate, post-auth flow).
- Reuse existing tokens, `Logo`, and `MARKETING_COPY`; add new copy/data to `src/lib/marketing/`, never inline magic strings (coding standards).

## Architecture

- **Server components by default.** Each section is its own component under `src/components/marketing/`. The page composes them in order.
- **Client components only where interactivity is required:**
  - `nav.tsx` — scroll-aware styling (transparent → solid on scroll) and mobile menu toggle.
  - `pricing.tsx` (or a `pricing-toggle.tsx` child) — monthly/yearly billing toggle holds local state.
  - Smooth-scroll anchor links can be plain `<a href="#id">` with CSS `scroll-behavior: smooth` — no JS needed.
- **DRY:** shared section wrapper (consistent `max-w-6xl`, padding, `scroll-mt` for anchored sections) and a small `SectionHeading` (eyebrow + title + optional subtitle) reused across Features, AI, Pricing.
- Centralize all section copy and the feature/pricing data as typed objects in `src/lib/marketing/` (e.g. `features.ts`, `pricing.ts`), mirroring how `copy.ts` and `dashboard-snapshot.ts` already work.

## Page Composition (`src/app/page.tsx`)

```
<Nav />            // fixed top
<main>
  <Hero />         // existing — unchanged
  <Features />     // #features
  <AiSection />    // pro AI feature
  <Pricing />      // #pricing
  <CtaBanner />    // closing conversion strip
</main>
<Footer />
```

The existing slim header in `page.tsx` is replaced by `<Nav />`.

## Sections

### Navigation (`nav.tsx`, client)

- Fixed to top, full width, `z` above content. Transparent over the hero; gains a solid `bg-surface`/border-bottom after a small scroll offset (client state via scroll listener or `IntersectionObserver` on a sentinel).
- **Left:** `Logo` (links to `/`). **Center/right (desktop):** anchor links "Features" (`#features`) and "Pricing" (`#pricing`). **Right:** "Sign in" (`/sign-in`, ghost) + "Get Started" (`/register`, solid green).
- **Mobile (<768px):** collapse links into a toggle (use the native Popover API or a disclosure button + `aria-expanded`). Keep "Get Started" visible.
- Semantic `<nav aria-label="Primary">`; anchor links use real `href="#..."`.

### Features (`features.tsx`, server)

- `<section id="features">` with `SectionHeading`, then a responsive grid: `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`, **6 cards**.
- Each card: Lucide icon in a colored square (reuse the dashboard icon-square pattern), title, one-line description. Data-driven from `FEATURES` in `src/lib/marketing/features.ts` (each entry: `icon`, `title`, `description`).
- Feature set should reflect real MVP capabilities (e.g. Fast manual entry, Monthly budgets, Goals, Recurring drafts, Reports, Data export) — only ship cards for features that exist.

### AI Section (`ai-section.tsx`, server)

- Two-column (`lg:grid-cols-2`), stacked on mobile.
- **Left:** a "Pro Feature" badge (reuse the success-tinted pill style from `PlanBadge`), heading, and a checklist of AI capabilities (Lucide `Check` icons, list from `src/lib/marketing/ai.ts`).
- **Right:** a static "code editor / AI-generated tags" mockup — a styled card with window chrome and a small sample of auto-tagged transactions. Decorative; mark non-semantic mock chrome `aria-hidden`. No real AI call — visual only.
- The AI capability is a real planned Pro feature whose backend lands later — ship this section now as the marketing surface, then wire the backend in a follow-up. Copy may present it as a Pro capability (not a "coming soon" placeholder), but the section itself stays visual-only until the backend exists.

### Pricing (`pricing.tsx` + `pricing-toggle.tsx`, client)

- `<section id="pricing">` with `SectionHeading` and a **Monthly / Yearly** segmented toggle (local `useState`, accessible: `role="group"`, `aria-pressed` on options). Yearly shows the ~25% discount and a "Save 25%" hint.
- **Two cards** from `PRICING_PLANS` in `src/lib/marketing/pricing.ts`:
  - **Free** — feature list from the Plans table (unlimited accounts/transactions/budgets/goals/recurring, last-3-months reports, CSV/JSON export). CTA "Get Started Free" → `/register`.
  - **Pro** — highlighted (green ring/border) with a **"Most Popular"** badge. Shows the price reactive to the toggle (monthly vs yearly). CTA "Get Pro" → `/register` (real checkout is post-auth, out of scope here).
- Prices live in the data module: **$3/month** and **$25/year** (the yearly "Save 25%" hint is derived from these, not hardcoded). No hardcoded numbers in the component.

### CTA Banner (`cta-banner.tsx`, server)

- Full-width closing strip: short headline + single primary "Get Started Free" → `/register`. Reuses hero button styling. Reinforces the reassurance line ("Free to start. No credit card required.").

### Footer (`footer.tsx`, server)

- Semantic `<footer>`. `Logo` + tagline on the left; link columns (e.g. Product → Features/Pricing/Sign in; Legal → Privacy/Terms if/when they exist — only link to real pages).
- Copyright line with the **current year computed at render** (`new Date().getFullYear()` — server component, no magic constant).
- "Changelog" link (point at a real destination or omit until one exists — do not ship a dead link).

## Accessibility

- One `<h1>` (the hero headline); section titles are `<h2>`. Logical heading order throughout.
- Landmarks: `<nav>`, `<main>`, `<footer>`, each section labelled (`aria-labelledby` referencing its heading).
- Anchor nav links move focus to the target section; ensure `scroll-mt-*` offsets clear the fixed nav.
- Toggle and mobile menu are keyboard-operable with correct ARIA state; respect `prefers-reduced-motion` for any reveal transitions (the hero already does).
- Use modern Accessible HTML practices, Modern NextJs practices, Modern React Components practices, Modern Browser APIs practices, Modern Tailwind practices.

## Implementation Notes

- Keep `redirectIfAuthenticated()` at the top of the page — unchanged.
- Extend page `metadata` only if new sections introduce indexable copy worth surfacing; otherwise leave the existing hero-derived metadata.
- Match existing styling conventions (Tailwind v4 tokens in `globals.css`, shadcn/ui where a primitive fits, kebab-case filenames, constants split per `coding-standards.md`).
- Smooth scrolling: prefer CSS `scroll-behavior: smooth` on the root over JS.

## Testing

- Pure data/util additions in `src/lib/marketing/**` (e.g. a price formatter or yearly-discount calc) get Vitest unit tests per the workflow. Section components themselves are out of scope for tests (components rule).
- `npm run test:run` and `npm run build` must pass before commit.

## Out of Scope

- Stripe checkout / billing flow (post-auth, separate spec).
- Real AI categorization backend (post-MVP).
- Blog, docs, changelog content pages, legal pages — link only when they exist.
- The `#how-it-works` content beyond the Features section defined here.
