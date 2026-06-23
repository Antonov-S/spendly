# Spendly — Project Overview

> **A personal finance tracker built for intentional awareness, not automated bookkeeping.**
> Fast manual entry, clear budgets, honest goals — responsive web app.

---

## Table of Contents

- [Spendly — Project Overview](#spendly--project-overview)
  - [Table of Contents](#table-of-contents)
  - [Target User](#target-user)
  - [Product Philosophy](#product-philosophy)
  - [Tech Stack](#tech-stack)
  - [Desktop Mockup Reference](#desktop-mockup-reference)
  - [Architecture](#architecture)
    - [Three-layer conceptual model](#three-layer-conceptual-model)
    - [Key architectural decisions](#key-architectural-decisions)
  - [MVP Definition](#mvp-definition)
  - [Data Models](#data-models)
    - [Prisma Schema](#prisma-schema)
    - [Category Seed](#category-seed)
  - [Features](#features)
    - [Transactions](#transactions)
    - [Financial Accounts](#financial-accounts)
    - [Budgets](#budgets)
    - [Recurring Templates](#recurring-templates)
    - [Goals](#goals)
    - [Dashboard](#dashboard)
    - [Reports](#reports)
  - [Design System](#design-system)
  - [UI/UX Guidelines](#uiux-guidelines)
    - [Layout](#layout)
    - [Micro-interactions](#micro-interactions)
    - [Responsive behavior](#responsive-behavior)
  - [Onboarding](#onboarding)
  - [Routes](#routes)
    - [Pages](#pages)
    - [API Routes](#api-routes)
  - [Monetization](#monetization)
    - [Plans](#plans)
    - [Pricing](#pricing)
  - [Environment Variables](#environment-variables)
  - [Data Portability](#data-portability)
  - [Security](#security)
  - [Out of Scope (Post-MVP)](#out-of-scope-post-mvp)

---

## Target User

Young to mid-career professionals who already understand what they should be doing with their money but struggle to maintain disciplined tracking over time. They have multiple accounts (checking, credit card, cash, occasionally a foreign currency account), recurring expenses (rent, subscriptions), and short-term financial goals. They want clarity, not optimization.

---

## Product Philosophy

The core thesis: small moments of conscious engagement with each transaction build the financial mindfulness that automatic bank synchronization quietly erodes. Adding a transaction in 5 seconds with awareness is more valuable than auto-importing one that takes 30 seconds to recognize, categorize, and trust.

This explicitly differentiates Spendly from the bank-sync category (Mint, YNAB, Monarch). Every feature is evaluated against this frame — even recurring transactions produce **drafts requiring user confirmation** rather than silent ledger entries.

**Design principles:**

1. **Conscious capture is the goal.** Re-entering an expense in a previously-used category should complete in under 5 seconds.
2. **Dashboard is for state, Reports is for analysis.** "Where am I now" vs "what happened over time" — never the same screen.
3. **The app is mobile-first in layout, desktop-first in density.** The responsive web layout must be fully usable on a phone; the desktop view leverages the extra space for analytics and overview.
4. **Visual weight serves information, never decoration.**
5. **Decisions over options.** Pick one implementation, document why.
6. **Never UI without backing function.** No placeholder icons, no "coming soon" hints.

---

## Tech Stack

| Layer         | Technology                                                                        |
| ------------- | --------------------------------------------------------------------------------- |
| **Framework** | [Next.js 16](https://nextjs.org/) / React 19                                      |
| **Language**  | TypeScript                                                                        |
| **Database**  | [Neon](https://neon.tech/) (PostgreSQL)                                           |
| **ORM**       | [Prisma 7](https://www.prisma.io/)                                                |
| **Auth**      | [NextAuth v5](https://authjs.dev/) — Email/password + Google OAuth                |
| **Styling**   | [Tailwind CSS v4](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/) |
| **Payments**  | [Stripe](https://stripe.com/)                                                     |

> **Database rule:** Never use `db push` or directly modify the database. Always create migrations (`prisma migrate dev`) and run them in dev first, then prod.

---

## Desktop Mockup Reference

Developer-oriented layout reference for implementing the web dashboard. Full visual mockups are in `spendly-desktop.svg` and `spendly-mobile.svg`.

**Overall grid:** `220px fixed sidebar | flex-1 main area`. Topbar spans full width at `60px` height above both columns.

**Topbar (left → right):** Logo + wordmark → account selector pill (global filter, shows dot indicator when non-default) → spacer (flex-1) → right group: settings icon · avatar circle. **No search input in topbar. No bell icon** — notifications are post-MVP.

**Sidebar:** Flat nav list with 8px vertical padding, 10px horizontal. Active item: white background, green icon, 0.5px border. Primary daily-use items: Dashboard, Transactions, Budgets, Recurring, Goals, Reports. A separate bottom utility group holds an **Accounts** link (financial account management — a setup/config surface deliberately kept out of the primary daily-use nav) above Help. Help remains anchored to the bottom via `margin-top: auto`.

**Main area background:** one tone darker than sidebar (`bg-tertiary`). Internal padding `16px`. Three vertical stacks:

1. **Page header row** — hero balance block (label + large number + delta line) left-aligned; period pills + Add CTA button right-aligned.
2. **Monthly strip** — `grid grid-cols-3 gap-2`. Each card: colored icon square (24×24) + label + value. Income (green), Expenses (red), Cashflow (neutral).
3. **Content columns** — `grid grid-cols-[1.4fr_1fr] gap-2 flex-1`. Left panel: transactions table with 5 columns (Description, Category, Date, Account, Amount), right-aligned Amount column. Right panel: budget summary block (remaining + meta line) + 7 budget rows each with category icon square (18×18), name, amount string, 4px progress bar.

**Slide-in drawer:** fixed right, `w-[420px]`, slides in over content with 300ms ease. Backdrop overlay on the rest of the screen. Contains transaction form: type toggle (Income / Expense / Transfer) at top, then amount (large input), date picker, category selector, account selector, merchant (optional), note (optional), Save button at bottom.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                      Next.js App                          │
│                                                          │
│  ┌────────────────┐  ┌──────────────────────────────┐   │
│  │  Server Comps  │  │   Server Actions             │   │
│  │  + DB fetchers │  │   (all entity mutations)     │   │
│  │  /dashboard    │  │   src/actions/*              │   │
│  │  /transactions │  │                              │   │
│  │  /budgets      │  ├──────────────────────────────┤   │
│  │  /goals        │  │   API Routes (render-cycle   │   │
│  │  /recurring    │  │   exceptions only):          │   │
│  │  /reports      │  │   /api/stripe/webhook        │   │
│  │  /settings     │  │   /api/export/*              │   │
│  └────────────────┘  └──────────────────────────────┘   │
└──────────────────────────────────────────────────────────┘
                │
                ▼
        ┌──────────────┐
        │  Neon (PG)   │
        │  via Prisma  │
        └──────────────┘
```

### Three-layer conceptual model

**Data layer** — owns the raw financial state. Transactions are the canonical ledger. Accounts aggregate transactions; their balance is always **derived** (`startingBalance + SUM(transactions)`), never stored. Categories are a flat list (no hierarchy in MVP). Merchants are optional metadata on transactions, future-proofing subscription detection.

**Control layer** — modifies behavior through structure. Budgets impose a monthly spending ceiling per category (no rollover in MVP). Recurring templates generate drafts on schedule; drafts require user confirmation. Goals track virtual progress toward a target amount and have no automatic interaction with budgets or accounts.

**Insight layer** — surfaces understanding. Dashboard is a state screen only; Reports is a separate analytics module. The two are explicitly separated to prevent scope creep.

### Key architectural decisions

- **Archived accounts follow explicit rules.** `isArchived = true` accounts are: hidden from all account selectors and the account filter pill; excluded from Dashboard totals and metric strip; included in Reports only when explicitly selected; transactions remain intact and queryable. Archived accounts cannot receive new transactions.
- **Account balances are derived, not stored.** Prevents sync and reconciliation bugs. May be cached in read models later if query performance requires it.
- **Transfers = two linked transactions.** Each leg is a normal `Transaction`; both share a `transferPairId` string. No self-referencing relation needed.
- **Dashboard aggregates all accounts using `preferredCurrency` as the display unit.** The `currency` field on each account is stored for record-keeping, but exchange rate conversion is post-MVP. In practice most users have all accounts in one currency — the total is exact. When mixed currencies are detected, a visual indicator appears ("⚠ Mixed currencies — approximate total") without blocking the hero display. Full rate-based conversion is post-MVP.
  > **MVP note — single currency (EUR).** The shipped MVP is **EUR-only**: there is no currency picker (accounts are created in `DEFAULT_CURRENCY` from `src/lib/currency.ts`), so the mixed-currency code path above never triggers and the hero total is always exact. The per-account `currency` columns are retained so multi-currency needs no migration later. When multi-currency is built, the "⚠ approximate total" should be **replaced by per-currency subtotals** (a naïve cross-currency sum is meaningless), not kept. See `docs/features/financial-account-crud-spec.md` §10 "Multi-currency upgrade path".
- **Dates are calendar dates, not timestamps.** All `@db.Date` fields store a calendar date without time or timezone component. The client sends the user's local date (e.g. `2026-05-31`) directly — no UTC conversion is applied. This prevents "31 May at 23:30 local becoming 1 June UTC" from breaking monthly budget calculations.
- **Refetch on window focus.** Data is re-fetched when the browser tab regains focus (via React Query `refetchOnWindowFocus`). No WebSocket in MVP — this gives sufficient perceived freshness.
- **Soft delete + snackbar undo.** Deleted records receive `deletedAt` timestamp. User has 8 seconds to undo via snackbar. No Trash UI in MVP.
- **Search scoped to Transactions only.** No global search in topbar. The search input lives on the `/transactions` page and queries description, merchant, and note fields only.

---

## MVP Definition

MVP is complete when a user can perform the full financial loop end-to-end:

> capture → organize → control → understand

Concretely: add a transaction, see it affect a budget, review the period's cashflow on the dashboard. Required before ship:

- Account creation with starting balance and currency
- Transaction entry (income / expense / transfer) with category, account, optional merchant and note
- Flat category system with system defaults and user extensions
- Monthly budgets per category
- Recurring templates generating confirmation drafts
- Goals with manual progress updates
- Dashboard state screen
- Reports (always accessible, empty state when data is insufficient)
- Onboarding flow with empty state treatment per screen

---

## Data Models

### Prisma Schema

```prisma
// schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── User ────────────────────────────────────────────

model User {
  id                   String    @id @default(cuid())
  name                 String?
  email                String    @unique
  emailVerified        DateTime?
  image                String?
  password             String?   // hashed, null for OAuth users
  isPro                Boolean   @default(false)
  stripeCustomerId     String?   @unique
  stripeSubscriptionId String?   @unique
  preferredCurrency    String    @default("EUR") // dormant in EUR-only MVP; reconciled from "USD" (migration reconcile_currency_eur_default)
  createdAt            DateTime  @default(now())
  updatedAt            DateTime  @updatedAt

  accounts           Account[]
  sessions           Session[]
  financialAccounts  FinancialAccount[]
  transactions       Transaction[]
  categories         Category[]
  budgets            Budget[]
  goals              Goal[]
  recurringTemplates RecurringTemplate[]
}

// ─── NextAuth Models ──────────────────────────────────
// Required by NextAuth v5. Do not rename or modify fields.

model Account {
  id                String  @id @default(cuid())
  userId            String
  type              String
  provider          String
  providerAccountId String
  refresh_token     String?
  access_token      String?
  expires_at        Int?
  token_type        String?
  scope             String?
  id_token          String?
  session_state     String?

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
}

model Session {
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model VerificationToken {
  identifier String
  token      String   @unique
  expires    DateTime

  @@unique([identifier, token])
}

// ─── Enums ───────────────────────────────────────────

enum AccountType {
  CHECKING
  SAVINGS
  CREDIT_CARD
  CASH
  INVESTMENT
  OTHER
}

enum TransactionType {
  INCOME
  EXPENSE
  TRANSFER
}

enum RecurringCadence {
  DAILY
  WEEKLY
  MONTHLY
  YEARLY
}

enum DraftStatus {
  PENDING
  CONFIRMED
  DISMISSED
}

// ─── FinancialAccount ─────────────────────────────────
// Balance is NEVER stored — always derived at query time:
// startingBalance + SUM(transactions WHERE deletedAt IS NULL)

model FinancialAccount {
  id              String      @id @default(cuid())
  name            String
  type            AccountType
  currency        String      @default("EUR") // EUR-only MVP; reconciled from "USD" (migration reconcile_currency_eur_default)
  startingBalance Decimal     @default(0) @db.Decimal(12, 2)
  color           String?     // hex, e.g. "#1D9E75"
  icon            String?     // Lucide icon name
  isArchived      Boolean     @default(false)
  createdAt       DateTime    @default(now())
  updatedAt       DateTime    @updatedAt

  userId String

  user               User                @relation(fields: [userId], references: [id], onDelete: Cascade)
  transactions       Transaction[]
  recurringTemplates RecurringTemplate[]

  @@index([userId])
}

// ─── Category ─────────────────────────────────────────
// Flat list — no hierarchy in MVP.
// System categories are shared (userId = null); user categories are owned.

model Category {
  id        String   @id @default(cuid())
  name      String
  icon      String   // Lucide icon name
  color     String   // hex
  isSystem  Boolean  @default(false)
  userId    String?  // null for system categories
  createdAt DateTime @default(now())

  user               User?               @relation(fields: [userId], references: [id], onDelete: Cascade)
  transactions       Transaction[]
  budgets            Budget[]
  recurringTemplates RecurringTemplate[]

  @@unique([name, userId])
  @@index([userId])
}

// ─── Transaction ──────────────────────────────────────
// Transfers create two records sharing the same transferPairId.
// Both legs have isTransferLeg = true to prevent accidental recategorization.

model Transaction {
  id                  String          @id @default(cuid())
  type                TransactionType
  amount              Decimal         @db.Decimal(12, 2)
  currency            String
  date                DateTime        @db.Date  // calendar date in user's local timezone — no UTC conversion
  note                String?
  merchant            String?
  isTransferLeg       Boolean         @default(false) // true for both sides of a transfer
  deletedAt           DateTime?       // soft delete
  transferPairId      String?         // shared UUID linking both legs of a transfer

  userId              String
  financialAccountId  String
  categoryId          String?
  recurringTemplateId String?

  user              User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  financialAccount  FinancialAccount   @relation(fields: [financialAccountId], references: [id], onDelete: Cascade)
  category          Category?          @relation(fields: [categoryId], references: [id], onDelete: SetNull)
  recurringTemplate RecurringTemplate? @relation(fields: [recurringTemplateId], references: [id], onDelete: SetNull)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([userId, date])
  @@index([userId, financialAccountId])
  @@index([userId, categoryId])
  @@index([transferPairId])
  @@index([deletedAt])
}

// ─── Budget ───────────────────────────────────────────
// One budget per category per calendar month.
// month = 1–12, year = e.g. 2026. No rollover between periods.

model Budget {
  id         String   @id @default(cuid())
  amount     Decimal  @db.Decimal(12, 2)
  currency   String
  month      Int      // 1–12
  year       Int      // e.g. 2026
  isArchived Boolean  @default(false)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  userId     String
  categoryId String

  user     User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  category Category @relation(fields: [categoryId], references: [id], onDelete: Cascade)

  @@unique([userId, categoryId, month, year])
  @@index([userId])
  @@index([userId, year, month])
}

// ─── RecurringTemplate ────────────────────────────────
// Generates RecurringDrafts on schedule. Drafts require confirmation.

model RecurringTemplate {
  id             String           @id @default(cuid())
  name           String
  type           TransactionType
  amount         Decimal          @db.Decimal(12, 2)
  currency       String
  cadence        RecurringCadence
  nextOccurrence DateTime         @db.Date
  isActive       Boolean          @default(true)
  createdAt      DateTime         @default(now())
  updatedAt      DateTime         @updatedAt

  userId             String
  financialAccountId String
  categoryId         String?

  user             User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  financialAccount FinancialAccount @relation(fields: [financialAccountId], references: [id], onDelete: Cascade)
  category         Category?        @relation(fields: [categoryId], references: [id], onDelete: SetNull)
  drafts           RecurringDraft[]
  transactions     Transaction[]

  @@index([userId])
  @@index([isActive, nextOccurrence])
}

// ─── RecurringDraft ───────────────────────────────────
// Pending confirmation entry. Confirmed → creates Transaction. Dismissed → ignored.

model RecurringDraft {
  id              String      @id @default(cuid())
  suggestedDate   DateTime    @db.Date
  suggestedAmount Decimal     @db.Decimal(12, 2)
  status          DraftStatus @default(PENDING)
  createdAt       DateTime    @default(now())

  recurringTemplateId String

  recurringTemplate RecurringTemplate @relation(fields: [recurringTemplateId], references: [id], onDelete: Cascade)

  @@index([recurringTemplateId, status])
}

// ─── Goal ─────────────────────────────────────────────
// Virtual progress only. Does not affect account balances or budgets.
// currentAmount is a denormalized sum of GoalContribution.amount —
// kept for fast reads, always derivable from contributions.

model Goal {
  id            String    @id @default(cuid())
  name          String
  targetAmount  Decimal   @db.Decimal(12, 2)
  currentAmount Decimal   @default(0) @db.Decimal(12, 2)
  currency      String
  targetDate    DateTime? @db.Date
  isCompleted   Boolean   @default(false)
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  userId String

  user          User               @relation(fields: [userId], references: [id], onDelete: Cascade)
  contributions GoalContribution[]

  @@index([userId])
}

// ─── GoalContribution ─────────────────────────────────
// Created by the "Add contribution" action in the UI (drawer with
// amount, date, optional note). Also supports negative amounts for
// withdrawals. Incrementing currentAmount on Goal is done in the
// same transaction as inserting this record.

model GoalContribution {
  id        String   @id @default(cuid())
  amount    Decimal  @db.Decimal(12, 2) // negative = withdrawal
  date      DateTime @db.Date
  note      String?
  createdAt DateTime @default(now())

  goalId String

  goal Goal @relation(fields: [goalId], references: [id], onDelete: Cascade)

  @@index([goalId])
}
```

### Category Seed

```ts
// prisma/seed.ts
// All 20 categories are seeded. The "Personal" onboarding preset
// surfaces only the 11 most common ones by default; the rest are
// available to add but not shown until needed. This keeps onboarding
// lightweight while avoiding "create from scratch" friction for
// Insurance, Travel, Taxes etc.
const systemCategories = [
  // Core — shown in default onboarding preset
  { name: "Groceries", icon: "ShoppingCart", color: "#EF9F27", isSystem: true },
  { name: "Dining", icon: "UtensilsCrossed", color: "#D85A30", isSystem: true },
  { name: "Transport", icon: "Bus", color: "#7F77DD", isSystem: true },
  { name: "Housing", icon: "Home", color: "#1D9E75", isSystem: true },
  { name: "Utilities", icon: "Zap", color: "#F59E0B", isSystem: true },
  { name: "Health", icon: "Heart", color: "#D4537E", isSystem: true },
  { name: "Entertainment", icon: "Gamepad2", color: "#F97316", isSystem: true },
  {
    name: "Miscellaneous",
    icon: "MoreHorizontal",
    color: "#9CA3AF",
    isSystem: true
  },
  { name: "Salary", icon: "Briefcase", color: "#1D9E75", isSystem: true },
  { name: "Freelance", icon: "Laptop", color: "#10B981", isSystem: true },
  // Extended — available from category picker, not shown by default
  { name: "Subscriptions", icon: "Tv", color: "#378ADD", isSystem: true },
  { name: "Clothing", icon: "Shirt", color: "#888780", isSystem: true },
  { name: "Education", icon: "BookOpen", color: "#6366F1", isSystem: true },
  { name: "Insurance", icon: "Shield", color: "#64748B", isSystem: true },
  { name: "Gifts", icon: "Gift", color: "#EC4899", isSystem: true },
  { name: "Travel", icon: "Plane", color: "#0EA5E9", isSystem: true },
  { name: "Taxes", icon: "Landmark", color: "#6B7280", isSystem: true },
  { name: "Pets", icon: "PawPrint", color: "#92400E", isSystem: true },
  { name: "Investment", icon: "TrendingUp", color: "#F59E0B", isSystem: true },
  // Fallback — cannot be deleted; used when a category is removed
  {
    name: "Uncategorized",
    icon: "HelpCircle",
    color: "#D1D5DB",
    isSystem: true
  }
];
```

> **✅ Shipped — user category management (`feature/user-category-management`, ROADMAP §3).** Beyond the
> 20 seeded system categories, users can now **create / edit / delete their own** categories (name + icon
> + color). Creation is inline in the transaction / budget / recurring pickers via a shared
> `<CategoryPickerField>` ("+ New category" auto-selects the new row); edit/delete live in a "Categories"
> card on `/settings`. System categories (`isSystem = true`, `userId = null`) stay **immutable** — every
> mutation is scoped `where: { id, userId, isSystem: false }`. Name dedup is **case-insensitive** across
> system + own (app pre-check + a functional `(lower(name), userId)` unique index + `P2002` catch). Delete
> is a hard delete whose confirm dialog states the FK impact: transactions + recurring templates go
> **Uncategorized** (`SetNull`), budgets are **deleted** (`Cascade`). Not a Pro gate, no count limit, not
> in onboarding. No schema model change. See `docs/ROADMAP.md` §3 and
> `docs/features/user-category-management-spec.md`.

> **Note:** `isPro` is the gate, and it is **real and DB-driven** — there is no dev-wide "all users Pro"
> override in the codebase. The only Pro-gated feature is Reports history (Free ≤ 3 months, Pro ≤ 12); a
> real user becomes Pro via Stripe Checkout (`feature/stripe-billing`).

---

## Features

### Transactions

The core unit of Spendly. Quick create & access via a **slide-in drawer** (fixed right panel, 420px wide). All fields editable inline: type, amount, date, category, account, merchant, note. Date-grouped feed with filter pills (All / Income / Expense) and text search across description, merchant, and note — search is scoped to this page only, there is no global search. Structural filters (date range, category, account) are separate from search.

Transfers create two linked `Transaction` records sharing a `transferPairId`. In the feed, a transfer shows as one row with both accounts visible; filtering to a single account shows only the relevant leg with a transfer indicator.

Soft delete: deleted transactions receive `deletedAt` timestamp and disappear from the UI. An 8-second snackbar undo is the only recovery mechanism in MVP.

### Financial Accounts

Containers that hold transaction history. Balance is always derived at query time. Each account has its own currency — no cross-currency aggregation in MVP. The global account selector in the topbar scopes the entire UI to one account when active; a visible indicator appears when scope is non-default.

> **MVP note — EUR-only.** Account currency is **not user-selectable** in the MVP; every account is created in EUR (`DEFAULT_CURRENCY`). `startingBalance` is **signed** — liability accounts (e.g. credit cards) may open negative. The `currency` column and per-account currency model stay in place for the future multi-currency upgrade (`docs/features/financial-account-crud-spec.md` §10).

### Budgets

Monthly spending ceiling per category. No rollover between periods. Progress bars show three states: green (< 60%), amber (60–90%), red (> 100%). Dashboard surfaces budget-at-risk alerts when a category exceeds 80% mid-period.

### Recurring Templates

Templates generate `RecurringDraft` entries on schedule. Drafts require explicit user confirmation before becoming real transactions — preserving the conscious capture moment without typing burden. Templates can be paused and resumed.

Confirming a draft stamps the template's **`name` onto the resulting `Transaction.merchant`** (a `Transaction` has no separate description column — its displayed label comes from `merchant`). This keeps draft-born entries identifiable as "Netflix"/"Rent" across the transactions feed and the dashboard rather than falling back to the category name or a bare "Transaction" label.

### Goals

Virtual progress tracking. Progress is updated via an **"Add contribution"** action — a drawer with amount, date, and optional note. Each action creates a `GoalContribution` record; `currentAmount` on the goal is kept in sync as a denormalized sum for fast reads. Negative contributions (withdrawals) are supported. Goals do not affect account balances or budgets. Goals with a `targetDate` in the past and progress below 100% surface as overdue on the Dashboard.

> **✅ Shipped (`feature/goals-crud`).** The full `/goals` read/write stack is live: create / edit /
> complete / delete goals, a contribution drawer (contributions + withdrawals + delete), and the
> dashboard `GoalsWidget` "View all →" wired to `/goals`. See `docs/ROADMAP.md` §2 for the realized
> details. The implementation decisions below are baked in.

> **MVP note — implementation decisions (`docs/features/goals-crud-spec.md`).** The `/goals`
> read/write slice resolves several rules: **(1) completion is manual** — `completeGoal` is the only
> thing that sets `isCompleted`; the app never auto-completes at 100% (the architecture doc wins
> over the "manual or at 100%" wording elsewhere). **(2) Hard delete, no undo** — `Goal` has no
> `deletedAt`; deletion cascades to contributions and is guarded by a confirm dialog, not the
> 8-second snackbar. **(3) Contribution amounts are signed** (negative = withdrawal), taken verbatim
> with no server-side sign derivation; `currentAmount` may go negative or exceed the target. The
> data layer never clamps — the progress bar clamps to `[0, 100]` for display, and **overfunded**
> goals get an explicit "Over 100%" affordance rather than a silent flat bar. **(4) Overdue** means
> `targetDate` strictly before today (both floored to UTC midnight), `!isCompleted`, and
> `currentAmount < targetAmount` — defined once in `isGoalOverdue` (`src/lib/goals.ts`) and shared by
> the dashboard widget and the page. **(5) EUR-only** — goal `currency` is stamped `DEFAULT_CURRENCY`
> server-side. `isCompleted` is a soft tag (completed goals stay editable), not a closed lifecycle
> state.

### Dashboard

State screen only — never analytics. Shows: hero balance, monthly metric strip (Income / Expenses / Cashflow), sparkline chart, top budget bars, and an actionable insights strip (budgets at risk, recurring drafts pending, overdue goals). Goals widget with one-tap access to full Goals screen.

> **✅ Shipped — insights strip (`feature/dashboard-insights-strip`).** The actionable insights strip is
> live below the metric strip: up to three link pills — **budgets at risk** (≥ 80% spent, includes
> over-budget), **pending recurring drafts**, and **overdue goals** — each linking to its page. It
> renders nothing when all counts are zero (silence = nothing to act on). Counts are derived in-process
> from the data the dashboard already fetches (`getBudgetsData` / `getGoalsSummary`) plus a single
> draft `count`, with the at-risk and overdue rules each defined exactly once
> (`countAtRiskBudgets` in `src/lib/insights.ts`; `isGoalOverdue` in `src/lib/goals.ts`). See
> `docs/features/dashboard-insights-strip-spec.md` and `docs/ROADMAP.md` §4. (The strip was removed
> once during the Dashboard UI Mockup phase and re-confirmed for build on 2026-06-20.)

### Reports

Separate analytics module, always accessible. When there is insufficient data, charts show a helpful empty state with a progress nudge ("Add 15 more transactions to see spending trends") rather than a locked screen. Four charts in MVP:

| Chart                     | Type | Description                                                                                                                                        |
| ------------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spending by category      | Pie  | Distribution of expenses across categories                                                                                                         |
| Income vs Expenses        | Bar  | Side-by-side monthly comparison                                                                                                                    |
| Cashflow trend            | Line | Monthly net cashflow over the selected period                                                                                                      |
| Account balance over time | Bar  | Per-account balance progression — derived at query time. Future optimization: monthly balance snapshots for accounts with high transaction volume. |

Period selector applies to all charts (current month / last 3 months / last 12 months). Free tier is limited to the last 3 months; Pro unlocks the full 12-month range. Each chart is filterable by account via the global account selector.

> **✅ Shipped (`feature/reports-page`).** The full `/reports` analytics module is live — four
> dependency-free SVG charts (spending-by-category **donut**, income-vs-expenses grouped bars, cashflow
> line, account-balance grouped bars), a URL-driven period selector (`?period=` 1m/3m/12m), and account
> scoping via the global selector. **Read-only** (no mutations) — all data flows through server-only
> fetchers in `src/lib/db/reports.ts`. The Free 3-month / Pro 12-month gate is **real now** (`isPro` read
> from the DB via `getReportProfile`, not the session): a Free user requesting 12m keeps their 3-month
> charts rendered with an upgrade banner above the grid, and the 12-month query never runs. Charts gate
> **individually** — category + balance render on data presence; only the two trend charts hold out for
> `REPORTS_MIN_TRANSACTIONS = 15`. The account-balance chart shipped as the full per-month running
> time-series. See `docs/ROADMAP.md` §5 and `docs/features/reports-page-spec.md`.

> **MVP note — "last 12 months" is the Pro ceiling, not unbounded "all time."** The period selector tops out at 12 months, so that is the concrete Pro reporting window in MVP. True all-time history (and the unbounded queries it implies) is post-MVP. The Monetization table below uses "Last 12 months" for Pro to match this selector.

---

## Design System

**Color encoding — strictly semantic:**

| State                | Color | Hex       |
| -------------------- | ----- | --------- |
| Positive / in budget | Green | `#1D9E75` |
| Warning threshold    | Amber | `#EF9F27` |
| Over budget / loss   | Red   | `#E24B4A` |
| Neutral information  | Grey  | `#888780` |

**Typography roles:**

| Role          | Size (web)  | Size (mobile) | Weight |
| ------------- | ----------- | ------------- | ------ |
| KPI value     | 24–28px     | 20–24px       | 500    |
| Section title | 13px        | 13px          | 500    |
| Row text      | 11–12px     | 11–12px       | 400    |
| Metadata      | 10–11px     | 10–11px       | 400    |
| Eyebrow label | 9–10px caps | 9–10px caps   | 500    |

Tabler outline iconography throughout. Sentence case for all labels. No gradients, decorative shadows, or borders beyond subtle 0.5px separators. Dark mode default, light mode optional.

---

## UI/UX Guidelines

### Layout

```
┌──────────────────────────────────────────────────────────┐
│  Sidebar (collapsible)       │  Main Content              │
│                              │                            │
│  ▸ Dashboard                 │  Hero balance              │
│  ▸ Transactions              │  ───────────────────────   │
│  ▸ Budgets                   │  Metric strip              │
│  ▸ Recurring                 │  ───────────────────────   │
│  ▸ Goals                     │  Transactions panel        │
│  ▸ Reports                   │  ───────────────────────   │
│  ─────────────────           │  Budget panel              │
│  ▸ Accounts                  │                            │
│  ▸ Help                      │                            │
└──────────────────────────────┴────────────────────────────┘
                                                       │
                                              ┌────────▼────────┐
                                              │  Slide-in Drawer │
                                              │  create / edit   │
                                              │  transaction     │
                                              └─────────────────┘
```

- Sidebar collapses to icon-only on tablet (768–1024px); becomes a hamburger overlay on mobile (< 768px)
- All transactions open in a **right-side slide-in drawer** — never a new page
- On mobile (< 768px) the drawer slides up from the bottom as a sheet, occupying ~90vh
- Mobile layout shows a bottom navigation bar: Home, Transactions, Budgets, More + floating add button
- No global search in topbar — search lives only on the Transactions page

### Micro-interactions

- Smooth drawer open/close transitions (300ms ease-in-out)
- Hover states on all cards and table rows
- Toast notifications for create, update, delete, transfer
- 8-second snackbar undo after destructive actions
- Loading skeletons during data fetches

### Responsive behavior

Under 768px: sidebar collapses to hamburger, bottom navigation appears. 768–1024px: icon-only collapsed sidebar. Above 1024px: full labeled sidebar. Account filter chip persists across all breakpoints.

---

## Onboarding

Required steps on first launch:

1. Create account (email + password, or Google OAuth)
2. Pick preferred currency (defaults to user locale)
3. Create at least one financial account with starting balance and currency
4. Optional: seed starter budgets for the current month
5. Land on empty Dashboard with explicit empty-state CTA

> **✅ Shipped (`feature/onboarding-currency`).** The first-run gate is live. A registered user with
> **zero active accounts** is redirected from the data surfaces (`/dashboard`, `/transactions`,
> `/budgets`, `/recurring`, `/goals`) to a dedicated `/onboarding` route via the per-page server
> guard `requireOnboarded()` (gate is **derived** from `activeAccountCount > 0`, not a stored flag).
> The flow is 3 steps — create first account (mandatory) → seed starter budgets (optional) → done →
> `/dashboard`. `/accounts` and `/profile` stay reachable as escape hatches. Step 2 (currency picker)
> is **not built** — EUR-only; `preferredCurrency` defaults to `DEFAULT_CURRENCY` (EUR) and is dormant.
> The dashboard also has a defensive zero-account fallback card. See `docs/ROADMAP.md` §1 + §0.

> **MVP note — EUR-only.** Step 2 (currency picker) is deferred while the app is single-currency EUR; onboarding skips it and `preferredCurrency` defaults to `DEFAULT_CURRENCY` (EUR). The schema default was reconciled from `"USD"` to `"EUR"` (migration `reconcile_currency_eur_default`); `preferredCurrency` is dormant until the currency picker / multi-currency support lands (`docs/features/financial-account-crud-spec.md` §10).

> **MVP note — starter budgets, not named category presets.** Step 4 is realized as the optional `seedPresetBudgets` action (a single `BUDGET_PRESETS` set seeded for the current month), not a "Personal / Freelancer / Family" picker. All 20 categories are already system-seeded (`userId = null`), so a preset cannot *create* categories, and only one budget-preset set exists today. Named preset variants and a category-visibility model are post-MVP — see the Goals/Onboarding slice in `docs/ROADMAP.md`.

Each empty screen provides active guidance, not a blank state. Reports shows an empty state with a progress nudge when there is insufficient data. Budget and Goal screens offer one-tap creation from preset templates after minimal usage.

---

## Routes

### Pages

| Route           | Description                                   |
| --------------- | --------------------------------------------- |
| `/`             | Landing / marketing page                      |
| `/dashboard`    | Main state screen                             |
| `/transactions` | Full transaction feed with filters and search |
| `/budgets`      | Budget management                             |
| `/recurring`    | Recurring templates + pending drafts          |
| `/goals`        | Goal tracking                                 |
| `/reports`      | Analytics and trends                          |
| `/accounts`     | Financial account management — list, create, edit, archive |
| `/settings`     | User preferences (display-name edit), billing (plan read-out + Upgrade/Manage buttons), and data export ("Your data"). Account management lives at `/accounts`. **✅ Shipped** (`feature/settings-page` + `feature/stripe-billing`); the §8 Stripe Upgrade/Manage buttons are now live via `<BillingActions>`. |

### API Routes

> **Implementation note — entity CRUD is Server Actions, not REST.** The table below is the
> original REST design. The shipped architecture (see `docs/entity-crud-architecture.md`) routes
> **all** entity reads through server-only Prisma fetchers (`src/lib/db/`) and **all** mutations
> through `"use server"` Server Actions (`src/actions/`) called directly from server components —
> **not** the `/api/*` endpoints listed here. Dedicated API routes exist only where a request must
> be callable outside the Next.js render cycle: the **Stripe webhook**, **data export**
> (`/api/export/csv`, `/api/export/json` — streamed file downloads, not in the table below), and
> optionally a **recurring-draft generation** cron endpoint. Read the rows below as the logical
> operations each entity supports, realized as Server Actions unless one of those exceptions applies.

| Route                           | Method             | Description                                     |
| ------------------------------- | ------------------ | ----------------------------------------------- |
| `/api/financial-accounts`       | GET, POST          | List / create financial accounts                |
| `/api/financial-accounts/[id]`  | GET, PATCH, DELETE | Single account operations                       |
| `/api/transactions`             | GET, POST          | List (with filters) / create transactions       |
| `/api/transactions/[id]`        | GET, PATCH, DELETE | Single transaction (soft delete)                |
| `/api/transactions/transfer`    | POST               | Create transfer — two linked transactions       |
| `/api/categories`               | GET, POST          | List system + user categories / create user cat |
| `/api/categories/[id]`          | PATCH, DELETE      | Update / delete user category                   |
| `/api/budgets`                  | GET, POST          | List / create budgets                           |
| `/api/budgets/[id]`             | GET, PATCH, DELETE | Single budget operations                        |
| `/api/goals`                    | GET, POST          | List / create goals                             |
| `/api/goals/[id]`               | GET, PATCH, DELETE | Single goal operations                          |
| `/api/goals/[id]/contributions` | GET, POST          | List / add goal contributions                   |
| `/api/goals/contributions/[id]` | DELETE             | Remove a contribution                           |
| `/api/recurring`                | GET, POST          | List / create recurring templates               |
| `/api/recurring/[id]`           | GET, PATCH, DELETE | Pause / resume / delete template                |
| `/api/recurring/drafts`         | GET                | List all pending drafts                         |
| `/api/recurring/drafts/[id]`    | PATCH              | Confirm or dismiss a draft                      |
| `/api/reports/overview`         | GET                | Month-over-month summary                        |
| `/api/reports/categories`       | GET                | Category breakdown by period                    |
| `/api/stripe/webhook`           | POST               | Handle Stripe billing events                    |

---

## Monetization

**Model: Free forever with feature gates.** No trial period. Registration is required to use the app — the entire architecture is user-centric (NextAuth, Stripe, row-level ownership). Pro unlocks deeper analytics and data ownership features.

### Plans

| Feature                  | Free          | Pro       |
| ------------------------ | ------------- | --------- |
| Financial accounts       | Unlimited     | Unlimited |
| Transactions             | Unlimited     | Unlimited |
| Budgets & goals          | Unlimited     | Unlimited |
| Recurring templates      | Unlimited     | Unlimited |
| Reports history          | Last 3 months | Last 12 months |
| Data export (CSV / JSON) | ✓             | ✓         |

### Pricing

| Plan        | Price        |
| ----------- | ------------ |
| **Monthly** | €3 / month   |
| **Annual**  | €25 / year   |

> Prices are single-sourced from `PRICING` in `src/lib/marketing/pricing.ts` (`currency: "€"`) and must
> match the Stripe Prices configured for the "Spendly Pro" product. The annual plan is a ~31% discount vs
> paying monthly (`yearlyDiscountPercent`, derived — never hardcoded).

> **✅ Shipped — Stripe billing (`feature/stripe-billing`, ROADMAP §8).** Free users can subscribe to Pro
> (€3/mo or €25/yr) from `/settings`, and Pro users manage/cancel via the Stripe Customer Portal. A
> signature-verified webhook (`POST /api/stripe/webhook`) reconciles `User.isPro` / `stripeCustomerId` /
> `stripeSubscriptionId` so the plan flips **without a re-sign-in** (all billing UI reads `isPro` fresh from
> the DB — never the JWT). The webhook is the **only** surface that may grant Pro; subscription events use
> `updateMany` so out-of-order delivery is a safe no-op. Account deletion best-effort cancels the live
> subscription. This makes the existing Reports 12-month gate reachable; no new gate was added. See
> `docs/ROADMAP.md` §8 and `docs/features/stripe-billing-spec.md`.

**Account deletion:** 30-day grace period. Account deactivated immediately, data preserved. User is prompted to export before deletion. After 30 days, all data permanently purged.

> **Note:** `User.isPro` is the single gate, and it is **real and DB-driven today** — there is no dev-wide
> `isPro = true` override (the seed creates both `demo-pro` and `demo-nonpro`, and every gate reads the
> real column via `getReportProfile`/`getUserOverview`). The only Pro-gated feature is Reports history
> (Free ≤ 3 months, Pro ≤ 12). As of `feature/stripe-billing`, a real user can become Pro through Stripe
> Checkout, so the gate is fully exercisable end-to-end.

---

## Environment Variables

```bash
# Database
DATABASE_URL=

# NextAuth
AUTH_SECRET=
AUTH_URL=

# Google OAuth
AUTH_GOOGLE_ID=
AUTH_GOOGLE_SECRET=

# Stripe
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_ID_MONTHLY=
STRIPE_PRICE_ID_YEARLY=
```

---

## Data Portability

Export is available on all tiers — it is not a Pro gate. A finance app that withholds user data erodes trust and is difficult to justify. Pro users can export on-demand; Free users can also export at any time.

- **CSV export** — transactions with date, amount, type, category, account, merchant, note
- **JSON export** — complete structured dump: accounts, categories, budgets, goals, contributions, recurring templates, transactions
- Both exports scoped to the current account filter (all accounts or one)
- Exports generated server-side and streamed as a file download

> **✅ Shipped (`feature/data-export`).** Live at `GET /api/export/csv` and `GET /api/export/json` —
> the first non-auth API routes (a file download can't be a Server Action). CSV is a flat RFC-4180
> ledger (UTF-8 BOM + an Excel `sep=,` hint so it opens straight into columns; formula-injection-safe
> free-text columns; transfers as two rows so `SUM(Amount)` reconciles). JSON is a versioned envelope
> `{ schemaVersion: 1, exportedAt, data }` with derived account balances, **user-owned categories
> only**, budgets, goals + nested contributions, recurring templates, and non-deleted transactions.
> Both are `auth()`-guarded and `userId`-scoped, **tier-agnostic (no `isPro` read)**, per-user
> rate-limited with a unified `{ error, code }` 401/429/413 contract, and scoped by the `?account=`
> filter (account-bound entities scope; budgets/goals/categories stay full — the intentional
> asymmetry). Entry point: the "Export CSV / JSON" links now live in the `/settings` "Your data"
> section (relocated from `/accounts` by `feature/settings-page`), with an active-scope label. See
> `docs/ROADMAP.md` §6 + §7 and `docs/features/data-export-spec.md`.

---

## Security

Fintrack handles personal financial data. Minimum security requirements before ship:

- Passwords hashed with **bcrypt** (`bcryptjs`, 12 salt rounds)
- All API routes validate **row-level ownership** — every query filters by `userId` from the authenticated session; no reliance on client-supplied IDs alone
- HTTPS enforced; HTTP requests redirected at infrastructure level
- No financial data in URL parameters or query strings
- Stripe webhook endpoint validates `stripe-signature` header on every request
- `AUTH_SECRET` rotated before production; never committed to version control
- No cross-user data exposure — all Prisma queries scoped to the authenticated user's `userId`

---

## Out of Scope (Post-MVP)

- Native mobile app (React Native / Expo)
- Email and push notifications of any kind
- Automatic transaction categorization (rule-based, then ML-based)
- Subscription detection via recurring-spend clustering
- Bank account synchronization via Open Banking APIs
- Linked savings accounts for Goals (real money holding)
- Cross-currency aggregation and base reporting currency
- Automatic exchange rate fetching
- Category hierarchy / subcategories
- Budget rollover between periods
- WebSocket real-time sync
- Dedicated Trash UI with restore flow
- Family / team multi-user accounts
- Performance optimizations for > 10K transactions per user

---

_Last updated: 2026_
