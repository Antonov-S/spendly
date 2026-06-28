import { describe, it, expect } from "vitest";
import {
  parseCsv,
  stripBomAndSepHint,
  detectDelimiter,
  detectDecimal,
  detectDateFormat,
} from "@/lib/import/csv";

describe("parseCsv", () => {
  it("parses plain comma-separated rows", () => {
    expect(parseCsv("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles a quoted field with embedded comma, CRLF, and escaped quotes", () => {
    const text = 'a,b\r\n"x,y","he said ""hi"""';
    expect(parseCsv(text)).toEqual([
      ["a", "b"],
      ["x,y", 'he said "hi"'],
    ]);
  });

  it("keeps an embedded newline inside a quoted field", () => {
    const text = 'a,b\n"line1\nline2",z';
    expect(parseCsv(text)).toEqual([
      ["a", "b"],
      ["line1\nline2", "z"],
    ]);
  });

  it("treats \\r\\n and \\n equivalently and drops a trailing newline (no phantom row)", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv("a,b\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("preserves a ragged row instead of shifting columns", () => {
    expect(parseCsv("a,b,c\n1,2")).toEqual([
      ["a", "b", "c"],
      ["1", "2"],
    ]);
  });

  it("drops a wholly-blank physical line", () => {
    expect(parseCsv("a,b\n\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("truncates a single field longer than the cell cap", () => {
    const big = "x".repeat(50);
    const [row] = parseCsv(`${big},b`, ",", 10);
    expect(row[0]).toHaveLength(10);
    expect(row[1]).toBe("b");
  });

  it("truncates a quoted multi-line field by accumulated characters incl. newlines", () => {
    const inner = "abcde\nfghij\nklmno"; // 17 chars incl. 2 newlines
    const [row] = parseCsv(`"${inner}",z`, ",", 8);
    expect(row[0]).toHaveLength(8);
    expect(row[0]).toBe("abcde\nfg");
  });

  it("parses a semicolon-delimited file when told the delimiter", () => {
    expect(parseCsv("a;b\n1;2", ";")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("stripBomAndSepHint", () => {
  it("strips a leading BOM", () => {
    expect(stripBomAndSepHint("﻿a,b")).toBe("a,b");
  });

  it("strips a sep= hint line after the BOM", () => {
    expect(stripBomAndSepHint("﻿sep=,\r\nDate,Amount")).toBe(
      "Date,Amount"
    );
  });

  it("is idempotent", () => {
    const once = stripBomAndSepHint("﻿sep=,\nDate,Amount");
    expect(stripBomAndSepHint(once)).toBe(once);
  });

  it("leaves a normal header untouched", () => {
    expect(stripBomAndSepHint("Date,Amount\n1,2")).toBe("Date,Amount\n1,2");
  });
});

describe("detectDelimiter", () => {
  it("detects comma, semicolon, and tab from the header line", () => {
    expect(detectDelimiter("a,b,c")).toBe(",");
    expect(detectDelimiter("a;b;c")).toBe(";");
    expect(detectDelimiter("a\tb\tc")).toBe("\t");
  });

  it("ignores delimiters inside quotes and defaults to comma", () => {
    expect(detectDelimiter('"a;b;c;d"')).toBe(",");
  });
});

describe("detectDecimal", () => {
  it("detects a comma decimal from European amounts", () => {
    expect(detectDecimal(["1.234,56", "9,99"])).toBe(",");
  });

  it("detects a dot decimal from US amounts", () => {
    expect(detectDecimal(["1,234.56", "9.99"])).toBe(".");
  });

  it("defaults to dot with no signal", () => {
    expect(detectDecimal(["100", "250"])).toBe(".");
  });
});

describe("detectDateFormat", () => {
  it("detects ISO", () => {
    expect(detectDateFormat(["2026-01-02", "2026-12-31"])).toBe("YYYY-MM-DD");
  });

  it("detects dotted day-first", () => {
    expect(detectDateFormat(["02.01.2026", "31.12.2026"])).toBe("DD.MM.YYYY");
  });

  it("forces DD/MM when a first component exceeds 12", () => {
    expect(detectDateFormat(["13/01/2026", "02/03/2026"])).toBe("DD/MM/YYYY");
  });

  it("defaults slashed to MM/DD when ambiguous", () => {
    expect(detectDateFormat(["01/02/2026", "03/04/2026"])).toBe("MM/DD/YYYY");
  });

  it("votes by majority so one junk/blank cell can't poison detection", () => {
    expect(
      detectDateFormat(["01.03.2026", "not-a-date", "", "02.03.2026", "03.03.2026"])
    ).toBe("DD.MM.YYYY");
  });
});
