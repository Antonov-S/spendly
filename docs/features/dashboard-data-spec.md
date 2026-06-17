# Dashboard Data Spec

## Overview

Replace the dummy data displayed in the main area of the dashboard (right side), with actual data from the database. It should look live, but instead of using data from mock-data.ts script, it should be from our Neon database using Prisma.

## Requirements

- Create `src/lib/db/dashboard.ts` with data fetching functions returning the existing dashboard types (`DashboardSummary`, `TransactionRow[]`, `BudgetRow[]`, `BudgetSummary`, `GoalRow[]`)
- Fetch data directly in server components (no client-side fetching)
- Transaction card border color derived from `TransactionType` (INCOME / EXPENSE / TRANSFER)
- Keep the current design. You can also reference the screenshot
- Update hero balance, metrics strip, transactions list, budgets panel, and goals widget with live DB values

## References

Check the `@docs/screenshots/desktop.png` screenshot if needed, but layout and design is already there. Keep in mind that screenshot was base on previews iterations and some staff was changed (user icon moved in bottom left, etc.)
