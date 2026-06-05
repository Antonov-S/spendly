import { vi } from "vitest";

// "server-only" throws when imported outside an RSC context.
// In tests we run server modules directly, so stub it to a no-op.
vi.mock("server-only", () => ({}));
