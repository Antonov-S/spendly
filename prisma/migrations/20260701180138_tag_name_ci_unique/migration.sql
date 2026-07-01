-- Case-insensitive uniqueness of a USER's own tag names, enforced atomically.
-- Prisma's schema DSL cannot express `lower(name)`, so this functional unique
-- index lives in migration history only (schema.prisma is unchanged; the existing
-- `@@unique([name, userId])` stays). It is strictly stronger on the name axis and
-- makes own-name dedup race-proof: two concurrent inserts of "vacation"/"Vacation"
-- by the same user can no longer both win — the loser raises P2002, which the tag
-- actions map to a friendly "already exists" message.
--
-- Unlike Category there are NO system tags — every Tag has a non-null userId — so
-- there is no NULL-owner tier to reason about here.
CREATE UNIQUE INDEX "Tag_lower_name_userId_key"
  ON "Tag" (lower("name"), "userId");
