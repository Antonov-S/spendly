-- Enforce at most one PENDING draft per recurring template at the DB level.
-- Prisma cannot express partial indexes in schema.prisma, so this lives in
-- migration history only (schema.prisma is unchanged). It backs the
-- `createMany({ skipDuplicates: true })` race guard in generatePendingDrafts.
CREATE UNIQUE INDEX "RecurringDraft_template_pending_unique"
ON "RecurringDraft" ("recurringTemplateId")
WHERE "status" = 'PENDING';
