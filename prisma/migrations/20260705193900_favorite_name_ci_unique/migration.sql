-- Case-insensitive uniqueness of a user's favorite names, enforced atomically.
-- Prisma's schema DSL cannot express `lower(name)`, so this functional unique
-- index lives in migration history only. The existing `@@unique([name, userId])`
-- remains as the case-sensitive schema-level constraint; this index is the
-- race-proof backstop for "Coffee" / "coffee" duplicates.
CREATE UNIQUE INDEX "Favorite_lower_name_userId_key"
  ON "Favorite" (lower("name"), "userId");
