<!-- Source of truth: codex-setup/agents-preamble.md — edit there + run `npm run codex:sync`; never hand-edit AGENTS.md. -->

# Spendly — project rules for Codex

Before working, read: docs/project-overview.md, docs/coding-standards.md,
docs/ai-interaction.md, docs/current-feature.md.

## Neon (NON-NEGOTIABLE)

- Project: `spendly` (`lucky-hat-53091250`). Never touch any other project.
- Branch: `development` (`br-hidden-bonus-aqksw1pa`) ONLY.
- NEVER query, mutate, or otherwise touch production (`br-falling-haze-aqyvxnbq`)
  unless the user explicitly says "production" in the current message.
- Read-only MCP by default. No `list_projects` / branch discovery — the IDs above
  are authoritative.
- Schema changes go through `prisma migrate dev` — never `db push`, never direct
  MCP mutations.

## Workflow

- Run `npm run test:run` and `npm run build` before proposing a commit; fix any
  failures first.
- Ask before committing. Use conventional commit messages, one feature/fix per commit.
- Never add agent attribution ("Generated with…", Co-Authored-By, etc.) to commit
  messages.
- Make minimal changes; preserve existing patterns; don't add unrequested features.
