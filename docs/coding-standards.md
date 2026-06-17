# Coding Standards

## TypeScript

- Strict mode enabled
- No `any` types - use proper typing or `unknown`
- Define interfaces for all props, API responses, and data models
- Use type inference where obvious, explicit types where helpful

## React

- Functional components only (no class components)
- Use hooks for state and side effects
- Keep components focused - one job per component
- Extract reusable logic into custom hooks

## Next.js

- Server components by default
- Only use `'use client'` when needed (interactivity, hooks, browser APIs)
- Use Server Actions for form submissions and simple mutations
- Use API routes when you need:
  - Webhooks (Stripe, GitHub, etc.)
  - File uploads with progress tracking
  - Long-running operations
  - Specific HTTP status codes or headers
  - Endpoints for future mobile/CLI clients
  - Third-party integrations
- Otherwise, fetch data directly in server components
- Dynamic routes for item/collection pages

## Tailwind CSS v4

**CRITICAL**: We are using Tailwind CSS v4, which uses CSS-based configuration.

- **DO NOT** create `tailwind.config.ts` or `tailwind.config.js` files (those are for v3)
- All theme configuration must be done in CSS using the `@theme` directive in `src/app/globals.css`
- Use CSS custom properties for colors, spacing, etc.
- No JavaScript-based config allowed

Example v4 configuration:

```css
@import "tailwindcss";

@theme {
  --color-primary: oklch(50% 0.2 250);
}
```

## File Organization

- Components: `src/components/[feature]/ComponentName.tsx`
- Pages: `src/app/[route]/page.tsx`
- Server Actions: `src/actions/[feature].ts`
- Types: `src/types/[feature].ts`
- Lib/Utils: `src/lib/[utility].ts`

## Naming

- Components: PascalCase (`ItemCard.tsx`)
- Files: Kebab-case
- Functions: camelCase
- Constants: SCREAMING_SNAKE_CASE
- Types/Interfaces: PascalCase (no prefix)

## Styling

- Tailwind CSS for all styling
- Use shadcn/ui components where applicable
- No inline styles
- Dark mode first, light mode as option

## Constants

- App-level constants (e.g. pagination, UI configuration, feature flags) must live in:
  src/lib/constants.ts
- System-level constants (e.g. colors, rate limits, environment variables, global system configuration) must live in:
  src/lib/system-constants.ts
  ❗ IMPORTANT: Never hardcode magic strings or magic values inside pages, components, or actions.
  All reusable or domain-relevant values must be extracted into the appropriate constants file.

## Database

- Use Prisma ORM for all database operations
- Always use `prisma migrate dev` for schema changes (not `db push`)
- Run `prisma migrate status` before committing to verify migrations are in sync
- Production deployments must run `prisma migrate deploy` before the app starts

## Data Fetching

- Server components fetch directly with Prisma
- Client components use Server Actions
- Validate all inputs with Zod

## Error Handling

- Use try/catch in Server Actions
- Return `{ success, data, error }` pattern from actions
- Display user-friendly error messages via toast

## Testing

- **Framework**: Vitest (Node environment, no jsdom)
- **Scope**: Test server actions (src/actions/**) and utilities (src/lib/**) only. Do not test React components.
- **Location**:
  All tests must live in a dedicated top-level test/ directory that mirrors the src/ structure.

test/
lib/
system-types.test.ts
actions/
account.test.ts

Rules:
The test/ directory mirrors src/ one-to-one
Test files must use the .test.ts suffix
Naming convention: test.<module>.test.ts or <module>.test.ts (choose one and stay consistent — recommended: <module>.test.ts)
Do not place any tests inside src/
Every file in src/lib and src/actions should have a corresponding test file where applicable
Keep test structure predictable for AI agents (no ad-hoc locations)

- **Database**: Never hit a real database in tests. Mock `@/lib/prisma` with `vi.mock(...)` and stub only the calls the unit under test makes.
- **External services**: Mock NextAuth (`@/auth`), Resend, Upstash, and any other I/O at the module boundary. Tests should be pure and fast.
- **What to cover**: input validation, branching/error paths, and the contract a caller depends on. Skip trivial pass-throughs.
- **Commands**: `npm test` for watch mode, `npm run test:run` for a single CI-style run. Both must pass before commit.

## Code Quality

- No commented-out code unless specified
- No unused imports or variables
- Keep functions under 50 lines when possible
