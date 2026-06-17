# Test Setup Specification

This document describes how to configure and write tests for a Next.js 16 / React 19 project using the tech stack below. Follow these rules exactly when initialising testing in a new project.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16 / React 19 |
| Language | TypeScript (strict) |
| ORM | Prisma 7 |
| Auth | NextAuth v5 (`next-auth@^5.0.0-beta`) |
| Test runner | Vitest ^4 |

---

## Scope

**Test only:**
- Server actions — `src/actions/**`
- Pure utilities and db helpers — `src/lib/**`

**Never test:**
- React components (`src/components/**`)
- Next.js pages / route handlers (`src/app/**`)
- Seed scripts, migration scripts (`scripts/**`)

Route handlers (e.g. `/api/stripe/webhook/route.ts`) are explicitly out of scope because importing them pulls `next-auth`'s `next/server` resolution into Vitest and poisons the worker (see Vitest config section for details).

---

## Directory Layout

All tests live in a top-level `test/` directory that mirrors `src/` one-to-one:

```
test/
  lib/
    utils.test.ts          ← mirrors src/lib/utils.ts
    billing.test.ts        ← mirrors src/lib/billing.ts
    format-date.test.ts
    db/
      items.test.ts        ← mirrors src/lib/db/items.ts
      collections.test.ts
  actions/
    account.test.ts        ← mirrors src/actions/account.ts
    items.test.ts
    ai-tags.test.ts
```

Rules:
- Use `.test.ts` suffix (never `.spec.ts`, never `.test.tsx`)
- File name matches the module under test: `billing.ts` → `billing.test.ts`
- Do **not** place any test files inside `src/`
- Every file in `src/lib` and `src/actions` should have a corresponding test file where applicable

---

## Installation

```bash
npm install --save-dev vitest
```

No additional test libraries are needed. Do not install `@testing-library/*`, `jest`, or `jsdom`.

---

## vitest.config.ts

Place at the project root:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true
  },
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["./vitest.setup.ts"],
    include: ["test/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**"
    ],
    // Vitest 4's parallel workers share a module-resolution cache, and
    // next-auth's `next/server` bare-specifier import fails under Node ESM
    // resolution. The failure in one worker poisons sibling workers. Running
    // files sequentially keeps each test file's resolution isolated, and
    // `isolate: true` forces a fresh module graph per file so the next-auth
    // failure can't leak across files in the same worker either.
    fileParallelism: false,
    isolate: true,
    clearMocks: true,
    restoreMocks: true
  }
});
```

Key options explained:
- `environment: "node"` — no browser globals, no jsdom
- `globals: false` — always import `describe`, `it`, `expect`, `vi` explicitly
- `tsconfigPaths: true` — resolves `@/*` path aliases from `tsconfig.json`
- `fileParallelism: false` + `isolate: true` — required workaround for next-auth/next/server module resolution poisoning in Vitest 4
- `clearMocks: true` + `restoreMocks: true` — reset mock state between tests automatically

---

## vitest.setup.ts

Place at the project root:

```ts
import { vi } from "vitest";

// "server-only" throws when imported outside an RSC context.
// In tests we run server modules directly, so stub it to a no-op.
vi.mock("server-only", () => ({}));
```

This single setup file is sufficient. Add nothing else here; per-module mocks go inside each test file.

---

## package.json scripts

```json
{
  "scripts": {
    "test": "vitest",
    "test:run": "vitest run"
  }
}
```

- `npm test` — watch mode (development)
- `npm run test:run` — single CI-style run (required to pass before every commit)

---

## Mocking Strategy

### Core principle

Mock at the **module boundary**. Never import real Prisma, NextAuth, Stripe, Resend, Upstash, OpenAI, or Cloudflare R2 clients in tests. Tests must be pure and fast.

### Required mocks by category

| Dependency | Mock path | What to stub |
|---|---|---|
| Database | `@/lib/prisma` | `prisma.<model>.<method>` as `vi.fn()` |
| Auth | `@/auth` | `auth`, `signOut` as `vi.fn()` |
| Stripe SDK | `@/lib/stripe` | `getStripe()` returning a stub with `subscriptions.cancel`, `checkout.sessions.create`, `billingPortal.sessions.create` |
| OpenAI SDK | `@/lib/openai` | `getOpenAI()` returning a stub with `responses.create` |
| Rate limiting | `@/lib/rate-limit` | `rateLimit`, `rateLimitMessage` as `vi.fn()` |
| Cloudflare R2 | `@/lib/r2` | `isR2Configured`, `deleteR2ObjectsByPrefix`, `deleteObjectFromR2`, `keyFromPublicUrl` as `vi.fn()` |
| Pro gate | `@/lib/billing` | `getUserIsPro`, `checkItemCapacity`, `checkCollectionCapacity` as `vi.fn()` |
| Next.js navigation | `next/navigation` | `redirect` — throw a `RedirectError` (see pattern below) |

### vi.mock placement

All `vi.mock(...)` calls must appear **before any imports** at the top of the file. Vitest hoists them automatically, but they must be the first statements in the file after the initial `import { ... } from "vitest"` line.

### vi.hoisted for fns referenced inside vi.mock factories

If a `vi.mock` factory function closes over a local `vi.fn()` variable, that variable must be created via `vi.hoisted()` because top-level `const` declarations are not yet initialized when mock factories run.

```ts
// WRONG — factory closes over a const that doesn't exist yet
const mockedCreate = vi.fn();
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({ checkout: { sessions: { create: mockedCreate } } })
}));

// CORRECT
const { mockedCreate } = vi.hoisted(() => ({
  mockedCreate: vi.fn()
}));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({ checkout: { sessions: { create: mockedCreate } } })
}));
```

Exception: if the mock factory does **not** close over any external variable (e.g. it only calls `vi.fn()` inline), `vi.hoisted` is not needed.

---

## Standard Mock Patterns

### Prisma mock

```ts
vi.mock("@/lib/prisma", () => ({
  prisma: {
    item: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn()
    },
    itemType: {
      findFirst: vi.fn()
    },
    tagsOnItems: {
      deleteMany: vi.fn()
    },
    itemCollection: {
      deleteMany: vi.fn(),
      createMany: vi.fn()
    },
    $transaction: vi.fn()
  }
}));

import { prisma } from "@/lib/prisma";

// Cast to vi.fn() for type-safe mock assertions
const mockedFindFirst = prisma.item.findFirst as unknown as ReturnType<typeof vi.fn>;
```

Only stub the Prisma methods your unit under test actually calls. Do not include methods not used in the module being tested.

### NextAuth mock

```ts
vi.mock("@/auth", () => ({
  auth: vi.fn(),
  signOut: vi.fn()
}));

import { auth, signOut } from "@/auth";

// `auth` is heavily overloaded in NextAuth; cast to a simple async fn for tests.
const mockedAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockedSignOut = signOut as unknown as ReturnType<typeof vi.fn>;
```

### next/navigation redirect mock

`redirect()` in Next.js throws a `NEXT_REDIRECT` control-flow error. Replicate that in tests by throwing a typed error so happy-path tests can assert on the redirect URL:

```ts
class RedirectError extends Error {
  url: string;
  constructor(url: string) {
    super(`NEXT_REDIRECT:${url}`);
    this.url = url;
  }
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectError(url);
  }
}));

// In a test:
await expect(someAction("monthly")).rejects.toThrow(RedirectError);
// or:
try {
  await someAction("monthly");
} catch (err) {
  expect((err as RedirectError).url).toBe("https://stripe.com/checkout/...");
}
```

### OpenAI mock

```ts
const mockedResponsesCreate = vi.fn();
vi.mock("@/lib/openai", () => ({
  AI_MODEL: "gpt-5-nano",
  getOpenAI: () => ({
    responses: {
      create: mockedResponsesCreate
    }
  })
}));
```

### Resend mock

```ts
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: vi.fn().mockResolvedValue({ data: { id: "msg_1" }, error: null }) };
  }
}));
```

### console.error spy (for swallowed errors)

When a function swallows an error via `try/catch` + `console.error`, spy on the console to suppress noisy output in the test run and restore it afterwards:

```ts
const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

// ... call the function ...

errSpy.mockRestore();
```

---

## Test File Structure

### Imports order

1. Vitest imports
2. `vi.mock(...)` calls (must be before module imports)
3. Module imports (`import { ... } from "@/..."`)
4. Cast helpers (`const mockedX = x as unknown as ReturnType<typeof vi.fn>`)
5. Shared fixtures / constants used across tests
6. `describe` blocks

### beforeEach reset pattern

Always reset mocks in `beforeEach`, not `afterEach`. Use `mockReset()` (clears calls + implementations) rather than `mockClear()` (clears calls only). When most tests share the same happy-path default, set it in `beforeEach` and let individual tests override only what differs:

```ts
describe("createItemAction", () => {
  beforeEach(() => {
    mockedAuth.mockReset();
    mockedGetUserIsPro.mockReset();
    mockedCreateItemForUser.mockReset();
    // Default: signed in as Pro user with a successful DB create
    mockedAuth.mockResolvedValue({ user: { id: "user_1", email: "u@example.com" } });
    mockedGetUserIsPro.mockResolvedValue(true);
    mockedCreateItemForUser.mockResolvedValue({ id: "item_1" });
  });

  it("rejects when there is no session", async () => {
    mockedAuth.mockResolvedValue(null); // override the default

    const result = await createItemAction({ ... });
    expect(result).toEqual({ success: false, error: "You are not signed in." });
  });
});
```

### What to cover

- **Auth guard** — no session returns the signed-out error; wrong user ID returns the signed-out error
- **Validation** — empty required fields, invalid formats, cross-field constraints
- **Branching / error paths** — not-found, wrong-owner, capacity exceeded, Pro gate
- **Happy path** — correct input produces the expected return shape and the correct DB/external call arguments
- **Call order** — when ordering matters (e.g. R2 sweep before DB delete), assert with `invocationCallOrder`
- **Swallowed errors** — when a function catches and logs instead of re-throwing, verify the primary action still completes

Skip trivial pass-throughs that have no logic to test.

---

## What NOT to unit-test

- Route handlers (`src/app/api/**`) — importing them pulls `next/server` into Vitest and poisons the worker
- SDK wrapper singletons (`src/lib/stripe.ts`, `src/lib/openai.ts`, `src/lib/r2.ts`) — these are thin construct-and-cache wrappers; their behavior is exercised indirectly through the action tests that mock `getStripe()` / `getOpenAI()`
- React components and hooks — components have no Vitest coverage; UI correctness is verified in the browser
- Database seed / maintenance scripts (`scripts/**`)

---

## Example Test Files

### Pure utility (no mocks needed)

```ts
// test/lib/utils.test.ts
import { describe, it, expect } from "vitest";
import { capitalize, parseTags } from "@/lib/utils";

describe("capitalize", () => {
  it("returns an empty string unchanged", () => {
    expect(capitalize("")).toBe("");
  });

  it("uppercases only the first character", () => {
    expect(capitalize("snippet")).toBe("Snippet");
  });
});

describe("parseTags", () => {
  it("splits, trims, and dedupes comma-separated tags", () => {
    expect(parseTags("react, prisma, react")).toEqual(["react", "prisma"]);
  });
});
```

### DB helper (Prisma mocked)

```ts
// test/lib/db/items.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    item: {
      findFirst: vi.fn(),
      updateMany: vi.fn()
    }
  }
}));

import { prisma } from "@/lib/prisma";
import { setItemFavoriteForUser } from "@/lib/db/items";

const mockedFindFirst = prisma.item.findFirst as unknown as ReturnType<typeof vi.fn>;
const mockedUpdateMany = prisma.item.updateMany as unknown as ReturnType<typeof vi.fn>;

describe("setItemFavoriteForUser", () => {
  beforeEach(() => {
    mockedFindFirst.mockReset();
    mockedUpdateMany.mockReset();
  });

  it("returns false when the item is not owned by the user", async () => {
    mockedUpdateMany.mockResolvedValue({ count: 0 });

    const result = await setItemFavoriteForUser("user_1", "item_x", true);

    expect(result).toBe(false);
    expect(mockedUpdateMany).toHaveBeenCalledWith({
      where: { id: "item_x", userId: "user_1" },
      data: { isFavorite: true }
    });
  });

  it("returns true when the update succeeds", async () => {
    mockedUpdateMany.mockResolvedValue({ count: 1 });

    const result = await setItemFavoriteForUser("user_1", "item_1", true);

    expect(result).toBe(true);
  });
});
```

### Server action (auth + DB mocked)

```ts
// test/actions/items.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));

vi.mock("@/lib/db/items", () => ({
  setItemFavoriteForUser: vi.fn()
}));

import { auth } from "@/auth";
import { setItemFavoriteForUser } from "@/lib/db/items";
import { setItemFavoriteAction } from "@/actions/items";

const mockedAuth = auth as unknown as ReturnType<typeof vi.fn>;
const mockedSetFavorite = setItemFavoriteForUser as unknown as ReturnType<typeof vi.fn>;

describe("setItemFavoriteAction", () => {
  beforeEach(() => {
    mockedAuth.mockReset();
    mockedSetFavorite.mockReset();
    mockedAuth.mockResolvedValue({ user: { id: "user_1" } });
    mockedSetFavorite.mockResolvedValue(true);
  });

  it("returns an error when there is no session", async () => {
    mockedAuth.mockResolvedValue(null);

    const result = await setItemFavoriteAction("item_1", true);

    expect(result).toEqual({ success: false, error: "You are not signed in." });
    expect(mockedSetFavorite).not.toHaveBeenCalled();
  });

  it("returns an error when the item is not found or not owned", async () => {
    mockedSetFavorite.mockResolvedValue(false);

    const result = await setItemFavoriteAction("item_x", true);

    expect(result).toEqual({ success: false, error: "Item not found." });
  });

  it("returns success and the new favorite state", async () => {
    const result = await setItemFavoriteAction("item_1", true);

    expect(result).toEqual({ success: true, isFavorite: true });
    expect(mockedSetFavorite).toHaveBeenCalledWith("user_1", "item_1", true);
  });
});
```

---

## Running Tests

```bash
# Watch mode during development
npm test

# One-shot run (CI / pre-commit gate)
npm run test:run
```

Both commands must pass before any commit. If either fails, fix the issues before committing.

---

## Common Pitfalls

| Symptom | Cause | Fix |
|---|---|---|
| `Cannot access 'mockedX' before initialization` | `vi.mock` factory closes over a top-level `const` | Wrap the fn in `vi.hoisted()` |
| All tests in a file pass in isolation but fail together | next-auth `next/server` module resolution poisoning | Ensure `fileParallelism: false` + `isolate: true` in config |
| `server-only` throws on import | Module guards RSC context | Already handled by `vitest.setup.ts` |
| Route handler test imports break other tests | `next/server` leaks into the worker | Do not test route handlers; keep them out of scope |
| Mock returns `undefined` unexpectedly | `mockReset()` called after the default was set | Set defaults inside `beforeEach`, not outside |
| `auth` TypeScript errors on `.mockResolvedValue` | `auth` is heavily overloaded | Cast: `auth as unknown as ReturnType<typeof vi.fn>` |
