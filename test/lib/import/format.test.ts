import { describe, it, expect } from "vitest";
import { detectImportFormat } from "@/lib/import/format";

describe("detectImportFormat", () => {
  it("detects .csv and .json", () => {
    expect(detectImportFormat("statement.csv")).toBe("csv");
    expect(detectImportFormat("export.json")).toBe("json");
  });

  it("is case-insensitive", () => {
    expect(detectImportFormat("DATA.CSV")).toBe("csv");
    expect(detectImportFormat("Backup.JSON")).toBe("json");
  });

  it("handles compound / dotted names", () => {
    expect(detectImportFormat("2026.q1.csv")).toBe("csv");
    expect(detectImportFormat("my.export.json")).toBe("json");
  });

  it("returns null for unknown / missing extensions", () => {
    expect(detectImportFormat("notes.txt")).toBeNull();
    expect(detectImportFormat("archive.zip")).toBeNull();
    expect(detectImportFormat("README")).toBeNull();
    expect(detectImportFormat("")).toBeNull();
  });

  it("tolerates surrounding whitespace", () => {
    expect(detectImportFormat(" data.csv ")).toBe("csv");
  });
});
