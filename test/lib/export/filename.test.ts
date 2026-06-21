import { describe, it, expect } from "vitest";
import { exportFilename } from "@/lib/export/filename";

describe("exportFilename", () => {
  it("builds spendly-export-YYYY-MM-DD.<ext>", () => {
    const now = new Date("2026-06-20T12:00:00.000Z");
    expect(exportFilename("csv", now)).toBe("spendly-export-2026-06-20.csv");
    expect(exportFilename("json", now)).toBe("spendly-export-2026-06-20.json");
  });

  it("zero-pads month and day", () => {
    const now = new Date("2026-01-05T12:00:00.000Z");
    expect(exportFilename("csv", now)).toBe("spendly-export-2026-01-05.csv");
  });

  it("uses UTC components, not local (stable across a UTC day boundary)", () => {
    // 2026-06-20T23:30Z is still the 20th in UTC regardless of server tz.
    const now = new Date("2026-06-20T23:30:00.000Z");
    expect(exportFilename("json", now)).toBe("spendly-export-2026-06-20.json");
  });
});
