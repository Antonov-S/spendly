-- Reconcile schema defaults to EUR (app is single-currency EUR; "USD" defaults were latent bugs).
-- AlterTable
ALTER TABLE "FinancialAccount" ALTER COLUMN "currency" SET DEFAULT 'EUR';

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "preferredCurrency" SET DEFAULT 'EUR';

-- One-time backfill: any row stamped USD predates the EUR-only resolution and is wrong.
-- Idempotent and scoped to = 'USD'; the app has never been multi-currency, so every
-- stored "USD" is a default-leak artifact, not a real monetary record.
UPDATE "User"              SET "preferredCurrency" = 'EUR' WHERE "preferredCurrency" = 'USD';
UPDATE "FinancialAccount"  SET "currency"          = 'EUR' WHERE "currency"          = 'USD';
UPDATE "Budget"            SET "currency"          = 'EUR' WHERE "currency"          = 'USD';
UPDATE "Goal"              SET "currency"          = 'EUR' WHERE "currency"          = 'USD';
UPDATE "Transaction"       SET "currency"          = 'EUR' WHERE "currency"          = 'USD';
UPDATE "RecurringTemplate" SET "currency"          = 'EUR' WHERE "currency"          = 'USD';
