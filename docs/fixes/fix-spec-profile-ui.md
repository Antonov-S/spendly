# Fix Spec: Profile Page UI Inconsistencies

Small visual/layout fixes for `/profile`. No logic or API changes — pure Tailwind/CSS only.
Add more items here before implementing.

---

## Issues

### 1. "Delete account" trigger button is too narrow

- **File:** `src/components/profile/delete-account-dialog.tsx` line 66
- **Problem:** Missing `w-full` — renders at intrinsic (content) width while every other button on the page stretches to full container width.
- **Fix:** Add `w-full` to the button's class list.

### 2. Plan value is plain text — add a status badge

- **File:** `src/app/profile/page.tsx` (the `Plan` `ProfileRow`, line 75)
- **Problem:** "Pro" / "Free" renders as plain `font-medium text-ink` like every other detail value, so plan status has no visual distinction. This is the one place on the page where semantic color is earned (status, not decoration).
- **Fix:** Render the plan as a small pill instead of plain text. Pro = `text-success` with `border-success/30 bg-success/10`; Free = neutral (`text-ink-2 border-line`). Keep sentence case. May need a small `PlanBadge` helper or an optional `valueNode`/`badge` prop on `ProfileRow` rather than a plain string.

### 3. Header card has no section heading — inconsistent with other cards

- **File:** `src/app/profile/page.tsx` (the detail-rows card, lines 57–79)
- **Problem:** Every other card ("Your data", "Change password", "Delete account") has a `text-[13px] font-medium` heading, but the account detail card (avatar + Plan/Currency/Member since rows) has none, breaking the visual rhythm.
- **Fix:** Add an "Account" heading (matching the `text-[13px] font-medium text-ink` style of the other sections) so all cards share the same structure. Place it consistently — either above the rows or as the card's section label.

### 4. Zero-value stats look identical to real counts

- **File:** `src/components/profile/profile-stats.tsx` (the `<dd>` value, line 52)
- **Problem:** A stat with value `0` renders in the same `text-ink` weight/color as a populated count, giving "nothing here yet" the same visual weight as real data.
- **Fix:** Dim zero values — conditionally use `text-ink-2` when `value === 0`, keep `text-ink` otherwise. No new color, just de-emphasis.

---

<!-- Add more issues below as you find them, same format:
### N. Short title
- **File:** path:line
- **Problem:** what's wrong
- **Fix:** what to change
-->
