# Fix Spec: Favorite Chip Tap Feedback

**Status: deferred polish — not blocking, not urgent.** Parked during the
`feature/quick-add-favorites` build QA (2026-07-05) so the idea isn't lost; pick up only if
real usage shows the gap matters. No functional bug exists — this is a feedback-visibility
refinement to a working flow.

Branch (when picked up): `fix/favorite-chip-tap-feedback`

Context: [quick-add-favorites-spec.md](../features/quick-add-favorites-spec.md) §8.1. Tapping
a favorite chip in the transaction drawer wholesale-prefills the form via
`buildFavoritePrefill` and never writes (`createTransaction` stays the sole writer).

---

## Issue — a chip tap gives no local acknowledgement

### Current behaviour

Tapping a chip in the favorites grid
([transaction-drawer.tsx](../../src/components/transactions/transaction-drawer.tsx),
`handleFavoriteTap`) applies the prefill instantly, but the chip itself shows nothing beyond
its hover style. The only confirmation is the form fields changing — which happens *above*
the chip block and can sit outside the visible viewport on the mobile bottom sheet (the type
toggle and amount field are directly below the strip, but a scrolled sheet or an open
keyboard can hide the change). A user who isn't watching the fields has no cue that the tap
landed, and may tap again (harmless — the prefill is idempotent — but it reads as "did that
work?").

For screen-reader users the gap is worse: the tap produces **no announcement at all**; the
silent state mutation of distant fields is invisible to assistive tech.

### Desired behaviour

A brief, calm acknowledgement on the tapped chip itself — visible where the finger already
is — plus a polite SR announcement. No toast (a toast for a non-mutation would devalue the
mutation toasts), no motion beyond a short style transition, no new color semantics.

### Proposed fix

1. **Transient pressed/applied state on the chip.** Track `appliedFavoriteId` in drawer
   state; `handleFavoriteTap` sets it and a ~600 ms timeout clears it (timeout stored in a
   ref; cleared on drawer close/reopen alongside the existing session resets so a flash never
   survives into a fresh drawer session). While active, the tapped chip swaps to the app's
   existing **neutral pressed style** — `border-ink-3 bg-ink/10`, the same pair the split
   toggle uses for its active state — then transitions back via the `transition-colors`
   already on the chip. Deliberately **not** a success-green flash: green is semantically
   "positive / in budget" and the footer Save's color; a prefill is not a save, and the
   feedback must not imply one (the same reasoning that rejected the green "Save as
   favorite" button — spec §8.2).
2. **SR announcement.** A visually-hidden `aria-live="polite"` line in the favorites block
   announcing `"{name} applied"` when `appliedFavoriteId` sets. One live region, text derived
   from state — no imperative DOM work.
3. Duration constant (`~600` ms) lives in `src/lib/constants.ts` if extracted at all; a
   single local `const` inside the component is acceptable for a one-consumer animation
   timing (match whichever the reviewer of the day prefers — it is UI timing, not policy).

### Why not CSS-only

`:active` lasts only while the pointer is down (too brief to register as confirmation), and
a keyframe animation re-triggered by React re-render needs a keyed remount hack that is more
code than the transient state. The timeout approach is ~10 lines and testable by inspection.

---

## What we are not doing (considered, rejected)

- **Hiding "Save as favorite" when the form exactly matches an existing favorite.** An
  exact-match check must compare seven fields against every favorite on each keystroke, and
  its payoff is suppressing one button in a rare edge case the server already handles
  politely (the case-insensitive duplicate-name error from `createFavorite`). Near-matches —
  same name, changed amount — *should* keep the button visible anyway, and distinguishing
  near from exact is precisely the complexity this rejection avoids. If duplicate attempts
  ever show up in telemetry (`favorite_created` failures), revisit; until then the
  duplicate-name error **is** the design.
- **A toast on chip tap.** Toasts are the app's mutation acknowledgements (create / update /
  delete / undo). A prefill is not a mutation; toasting it would dilute the signal the
  8-second undo snackbar depends on.
- **Scrolling the sheet to the amount field on tap.** Fights the user's scroll position and
  duplicates what `focusAmount` already does for the one case that needs focus
  (prompt-on-use favorites).

---

## Testing

### Unit (Vitest)

None — the change is component-internal timing/state, and components are out of Vitest scope
per project standards. `buildFavoritePrefill` and the actions are untouched; existing suites
must stay green (`npm run test:run`).

### Build / lint

`npm run build` and `npm run lint` must pass.

### Manual

1. Drawer (create mode) → tap a favorite chip → the chip visibly flashes the pressed style
   and settles back within ~1 s; form fields prefill as today.
2. Tap, then immediately close and reopen the drawer → no chip renders in the flashed state
   (timeout cleared on session reset).
3. Mobile bottom sheet (375 px) → the flash is visible without scrolling, at the tap point.
4. With a screen reader (VoiceOver/NVDA): tapping a chip announces "«name» applied".
5. Rapid double-tap → no error, prefill applied once-equivalent (idempotent), flash restarts.
