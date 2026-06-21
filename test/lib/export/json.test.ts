import { describe, it, expect } from "vitest";
import { buildExportEnvelope } from "@/lib/export/json";
import { EXPORT_JSON_SCHEMA_VERSION } from "@/lib/system-constants";

describe("buildExportEnvelope", () => {
  const now = new Date("2026-06-20T08:30:00.000Z");

  it("stamps the current schema version", () => {
    const env = buildExportEnvelope({ a: 1 }, now);
    expect(env.schemaVersion).toBe(EXPORT_JSON_SCHEMA_VERSION);
  });

  it("renders exportedAt as ISO 8601 from the injected now", () => {
    const env = buildExportEnvelope({ a: 1 }, now);
    expect(env.exportedAt).toBe("2026-06-20T08:30:00.000Z");
  });

  it("passes data through unchanged", () => {
    const data = { accounts: [{ id: "a1" }], transactions: [] };
    const env = buildExportEnvelope(data, now);
    expect(env.data).toBe(data);
  });

  it("wraps empty data as a valid envelope", () => {
    const env = buildExportEnvelope({}, now);
    expect(env).toEqual({
      schemaVersion: EXPORT_JSON_SCHEMA_VERSION,
      exportedAt: "2026-06-20T08:30:00.000Z",
      data: {},
    });
  });
});
