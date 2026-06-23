-- Case-insensitive uniqueness of a USER's own category names, enforced atomically.
-- Prisma's schema DSL cannot express `lower(name)`, so this functional unique
-- index lives in migration history only (schema.prisma is unchanged; the existing
-- `@@unique([name, userId])` stays). It is strictly stronger on the name axis and
-- makes own-name dedup race-proof: two concurrent inserts of "Groceries"/"groceries"
-- by the same user can no longer both win — the loser raises P2002, which the
-- category actions map to a friendly "already exists" message.
--
-- System rows have userId = NULL. Postgres treats NULLs as distinct in a unique
-- index, so system categories are unconstrained here (controlled by the seed) and
-- the system-name collision rule stays an app-level pre-check.
CREATE UNIQUE INDEX "Category_lower_name_userId_key"
  ON "Category" (lower("name"), "userId");
