# Homepage Mockup Spec — Hero Section

> Public landing page at `/`. Centerpiece: an animated hero that narrates the product thesis **Financial Chaos → Financial Clarity**.

## Goals

Build the **landing/marketing homepage at `/`** — the public, unauthenticated entry point. The centerpiece is an animated hero that visually narrates the product thesis: **Financial Chaos → Financial Clarity**.

Success looks like:

- A hero that loads instantly (text + CTA are the LCP, never blocked by the animation) and communicates the chaos→clarity story at a glance.
- The animation is on-brand (dark mode, semantic palette), accessible (`prefers-reduced-motion`), and performant on mobile and low-end devices.
- Every CTA points to a real destination — no placeholder buttons (per principle #6, "never UI without backing function").
- Authenticated visitors hitting `/` are sent to `/dashboard`; everyone else sees the marketing page.

## Scope

- **This spec covers the hero section only.** Other landing sections (features, pricing, footer) are explicitly out of scope here and will be separate specs. The page is built so those sections can be appended below the hero later.
- Route: `/` (already reserved for "Landing / marketing page" in `project-overview.md` routes table).
- Visual-only mockup first — no new backend. Reuse existing dashboard components/seed data for the revealed dashboard frame where feasible.

## Layout

- **Desktop (≥768px):** two-column layout — hero copy left, animation right.
- **Mobile (<768px):** stacked — copy above, animation below.
- Hero copy must remain fully visible and understandable **before** the animation loads. The copy carries the value proposition; the animation only supports it (see [Communication Requirement](#communication-requirement)).

## Hero Height

- **Desktop:** `min-height: 90vh`.
- **Mobile:** content-driven height (no forced viewport height).
- Headline, subheadline, CTAs, and the animation should fit above the fold on common desktop resolutions.

## Hero Animation — "Financial Chaos → Financial Clarity"

The narrative must feel **specifically about personal budgeting**, not generic organization or productivity software. A contained 3D-feeling scene of small cubes runs four finance-themed phases, then rests:

1. **Financial data / expenses** — ~80–120 cubes representing scattered, unsorted transactions drift, rotate, and float randomly. Conveys the disorder of untracked spending.
2. **Categorized spending** — cubes ease into groups/columns by category with magnetic, satisfying motion. Disorder becomes structure.
3. **Budget control** — the categorized cube groups **stack into 3–4 horizontal progress bars** (the real budget-bar pattern from the dashboard), each filling to a different level using the semantic palette: most green (`#1D9E75`, in budget), one amber (`#EF9F27`, nearing limit). This is the moment the finance story lands — keep it concrete and recognizable as "budgets," not an abstract grid.
4. **Dashboard reveal & stability** — the structure resolves inside a realistic app frame (see [Dashboard Reveal](#dashboard-reveal)) and holds on the finished Spendly dashboard.

**Color encodes the story (replaces the original "beige cubes"):** early-phase cubes are muted/desaturated greys (neutral = disorder); as they categorize and resolve into the dashboard, they settle into the brand green `#1D9E75`. Grey→green mirrors chaos→clarity, so color carries meaning rather than decoration. Stays within the semantic palette; no gradients or decorative shadows (per design system).

**Timing (target, tune in implementation):** phase 1 ~2s → phase 2 ~2.5s → phase 3 ~1.5s → phase 4 hold ~4s. Easing: ease-in-out throughout; the categorize/align motion should feel "magnetic" (slight overshoot/settle). Define exact ms in constants.

**Continuity (no abrupt cuts or unrelated morphs):** each phase must visually flow from the previous one — category groups *collapse into* budget rows, and budget rows *transform into* the corresponding dashboard components. The progression must read as:

> Expenses → Categories → Budget Bars → Dashboard

never:

> Expenses → Categories → Random Shape → Dashboard

## Dashboard Reveal

- The final reveal uses a **realistic application frame** (browser window or app frame) — **not** a phone outline.
- The dashboard preview **must reuse the actual application design system** — components, typography, spacing — and realistic seed data, not an invented mock (consistent with "never UI without backing function").
- Show realistic Spendly data:
  - Current month spending
  - Budget usage progress
  - Top spending categories
  - Savings goal progress
- **Avoid** anything that misrepresents the product: stock-market charts, trading interfaces, crypto-style visuals, investment dashboards. Spendly is a **budgeting** app, not an investment platform.

### Dashboard Data

- The public homepage is unauthenticated and cannot query a user's live Prisma data the way `/dashboard` does — so the reveal renders from a **static marketing snapshot**, not a DB fetch.
- Reuse existing dashboard seed data where it fits. If nothing suitable exists, create **one dedicated, typed marketing snapshot object** and reuse it consistently.
- The snapshot lives in a data/constants module (e.g. `src/lib/marketing/`), typed against the existing `src/types/dashboard.ts` shapes — **not hardcoded inside the hero component**, and no arbitrary magic values (per coding standards).

## Animation Behavior

- **Initial render is the static phase-4 dashboard** (see [Initial State](#initial-state)). The animation then starts automatically **500–1000ms after first paint**, gated on the hero being visible — never before.
- Play once on that first trigger, then **hold on the final "clarity" state** (do not loop perpetually — distracting and a battery drain).
- Replay only when the hero **re-enters the viewport** after being scrolled away.
- **No hover-based replay.**

## Initial State

- The static poster frame and loading state **are the final dashboard reveal (phase 4)**.
- Users immediately see the desired outcome (the finished dashboard) before any animation begins — never an empty hole or a mid-animation frame.
- After the ~500–1000ms delay, the animation "rewinds" to phase 1 and plays forward through to phase 4 again, landing back on the state the user already saw.

## Accessibility (mandatory)

- Respect `prefers-reduced-motion: reduce` — skip the chaos/organization entirely and render the static phase-4 dashboard frame immediately. No motion.
- The animation is decorative: mark it `aria-hidden` and ensure the headline, subheadline, and CTAs are fully usable and the real semantic content.

## Performance / Implementation Constraints

- **LCP must be the hero text + primary CTA**, painted immediately. The animation lazy-loads and must never block first paint. Ship a static poster frame (the final dashboard) as the first visual so there's no empty hole during load.
- **Render tech: CSS 3D transforms + a small JS phase state machine.** Decided over WebGL and over pre-rendered video/Lottie:
  - **Not WebGL (Three.js / R3F):** ~150KB+ for a decorative, plays-once hero on the most performance-critical page is the wrong trade — especially since the live scene only runs for the narrow desktop + motion-OK audience (reduced-motion and `<768px` both collapse to the static frame).
  - **Not video/Lottie:** the phase-4 reveal must reuse the *real* design system + seed data and stay pixel-consistent as the app evolves. A baked asset drifts out of sync and adds a render pipeline to maintain.
  - **CSS 3D wins:** cubes are `<div>`s on a `transform-style: preserve-3d` stage (`translate3d`/`rotate3d`, animated via Web Animations API), GPU-composited, near-zero bundle. Phase 4 is **real DOM** — the actual dashboard components — so it's automatically consistent and the cubes can morph straight into it.
  - **Cube count:** default **80** on desktop; treat 120 as an upper bound only.
- **There are exactly two render paths, nothing in between:** (1) the animated path — desktop, motion-OK; (2) the static phase-4 frame — used by both `prefers-reduced-motion` and `<768px`. Don't over-engineer intermediate fallbacks (e.g. reduced cube counts).
- The dashboard shown in phase 4 should be a realistic snapshot built from the **actual dashboard components / seed data**, not an invented mock — consistent with "never UI without backing function."
- **Total run is ~10s to rest.** No skip control is needed because phase 4 *is* the resting state. Copy and CTA never wait on the animation (per the LCP rule). Keep phase-1 drift slow and subtle, not flickery, even for motion-OK users.

## Mobile Fallback

For small screens (<768px):

- Render **only the final dashboard frame** (phase 4).
- **Skip the cube animation entirely.**
- No replay logic.

The animation is decorative and must not impact mobile performance.

## Communication Requirement

The hero must **support** the value proposition, not carry it. A visitor who never watches the animation must still understand:

- **What** Spendly does
- **Who** it is for
- **Why** it is different

The headline, subheadline, and CTA must communicate the core value **independently of the animation**.

## Progressive Enhancement

- The hero must render as a **complete, usable static experience without JavaScript** — headline, subheadline, both CTAs, and the phase-4 dashboard frame all exist in the **initial server-rendered HTML**.
- JavaScript only **enhances**: after hydration it layers the CSS-3D phase animation on top of the already-painted static frame.
- This is the natural consequence of the LCP rule and the [Initial State](#initial-state) (static phase-4 first) — call it out so the static path is built first and the animation is strictly additive.

## CTA Hierarchy & Relationship

- **Primary CTA ("Get Started Free")** visually dominates — solid, brand-green, the obvious preferred action.
- **Secondary CTA ("See how it works")** uses a lower-emphasis style (ghost / outline / text button). Users should instantly read which action is preferred.
- The revealed dashboard should clearly represent **what the user gets after registration**, creating a direct line between "Get Started Free" → the revealed dashboard → the core budgeting workflow.

## Copy

- **Headline:** "Turn Financial Chaos Into Clarity"
- **Subheadline:** *"Track spending consciously, set honest budgets, and reach your goals — no bank syncing, no autopilot."* Names the differentiator (manual / conscious capture) as a feature, not a chore, and covers what/who/why in one line per the [Communication Requirement](#communication-requirement).
- **Primary CTA:** "Get Started Free" → `/register`.
- **Secondary CTA:** **"See how it works"** — smooth-scrolls to the future features section (`#how-it-works`). Chosen over "Watch Demo" because no real demo exists yet and a dead button violates principle #6. Revisit a real demo video post-MVP.

> **Known follow-up:** the `#how-it-works` features section is out of scope for this hero-only milestone, so the secondary CTA has no target to scroll to yet. Until that section ships, either hide the secondary CTA or point it at a placeholder anchor — but do **not** ship it as a visibly dead button (principle #6). Wire it up when the features section lands.

## Anti-Goals

Do **not**:

- Add particle systems
- Add decorative background effects
- Add parallax scrolling
- Add infinite looping animations
- Add marketing charts
- Add stock / crypto / investment visuals
- Add WebGL, Three.js, or React Three Fiber
- Add intermediate fallback variants beyond the two defined render paths
- Add additional animation phases not defined in this spec

## Resolved Decisions

- **Render tech:** CSS 3D transforms + JS phase state machine (not WebGL, not video/Lottie). See [Performance / Implementation Constraints](#performance--implementation-constraints).
- **Secondary CTA:** "See how it works" scroll-anchor; no demo video for MVP.
- **Subheadline:** locked to the line above (was three competing drafts).
- **Hero height:** desktop `min-height: 90vh`, mobile content-driven.
- **Animation start:** static phase-4 first, auto-start 500–1000ms after first paint, gated on visibility.
- **Data:** static typed marketing snapshot in `src/lib/marketing/`, never hardcoded in the component.
- **Rendering model:** progressive enhancement — full static hero in SSR HTML, animation layered after hydration.
