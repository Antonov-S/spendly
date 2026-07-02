import { describe, it, expect } from "vitest";
import {
  EXPORT_CSV_HEADER,
  escapeCsvField,
  escapeCsvTextField,
  csvRow,
  transactionsToCsv,
} from "@/lib/export/csv";
import { EXPORT_CSV_COLUMNS } from "@/lib/constants";
import type { ExportTransactionRow } from "@/types/export";

function row(overrides: Partial<ExportTransactionRow> = {}): ExportTransactionRow {
  return {
    id: "t1",
    date: "2026-06-15",
    amount: -47,
    type: "EXPENSE",
    category: "Groceries",
    account: "Checking",
    merchant: "Aldi",
    note: null,
    isTransferLeg: false,
    transferPairId: null,
    financialAccountId: "a1",
    categoryId: "c1",
    recurringTemplateId: null,
    isSplit: false,
    splits: [],
    createdAt: "2026-06-15T10:00:00.000Z",
    ...overrides,
  };
}

describe("EXPORT_CSV_HEADER", () => {
  it("is the columns joined by commas", () => {
    expect(EXPORT_CSV_HEADER).toBe(EXPORT_CSV_COLUMNS.join(","));
    expect(EXPORT_CSV_HEADER).toBe("Date,Amount,Type,Category,Account,Merchant,Note");
  });
});

describe("escapeCsvField (RFC-4180 only)", () => {
  it("leaves a plain value unchanged", () => {
    expect(escapeCsvField("Aldi")).toBe("Aldi");
  });

  it("quotes a value containing a comma, doubling embedded quotes", () => {
    expect(escapeCsvField("a,b")).toBe('"a,b"');
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  it("quotes values containing CR or LF", () => {
    expect(escapeCsvField("a\nb")).toBe('"a\nb"');
    expect(escapeCsvField("a\rb")).toBe('"a\rb"');
  });

  it("renders null/undefined/empty as an empty field (not 'null')", () => {
    expect(escapeCsvField(null)).toBe("");
    expect(escapeCsvField(undefined)).toBe("");
    expect(escapeCsvField("")).toBe("");
  });

  it("renders a number as its string form", () => {
    expect(escapeCsvField(-47)).toBe("-47");
    expect(escapeCsvField(0)).toBe("0");
  });

  it("does NOT formula-prefix a leading = or - (Amount relies on this)", () => {
    expect(escapeCsvField("-47.00")).toBe("-47.00");
    expect(escapeCsvField("=cmd()")).toBe("=cmd()");
  });
});

describe("escapeCsvTextField (formula-neutralize THEN RFC-4180)", () => {
  it("prefixes a single quote for each formula trigger", () => {
    expect(escapeCsvTextField("=cmd()")).toBe("'=cmd()");
    expect(escapeCsvTextField("+1")).toBe("'+1");
    expect(escapeCsvTextField("-1")).toBe("'-1");
    expect(escapeCsvTextField("@x")).toBe("'@x");
    expect(escapeCsvTextField("\tx")).toBe("'\tx");
    expect(escapeCsvTextField("\rx")).toBe('"\'\rx"');
  });

  it("leaves a plain value unchanged", () => {
    expect(escapeCsvTextField("Aldi")).toBe("Aldi");
  });

  it("renders null/empty as an empty field", () => {
    expect(escapeCsvTextField(null)).toBe("");
    expect(escapeCsvTextField(undefined)).toBe("");
    expect(escapeCsvTextField("")).toBe("");
  });

  it("still RFC-4180 quotes comma/quote/newline content", () => {
    expect(escapeCsvTextField("a,b")).toBe('"a,b"');
    expect(escapeCsvTextField('x"y')).toBe('"x""y"');
  });

  it("does both: neutralizes the leading trigger and quotes the comma", () => {
    expect(escapeCsvTextField('=a,b"c')).toBe('"\'=a,b""c"');
  });
});

describe("csvRow", () => {
  it("comma-joins and terminates with CRLF, preserving order", () => {
    expect(csvRow(["a", "b", "c"])).toBe("a,b,c\r\n");
  });
});

describe("transactionsToCsv", () => {
  it("starts with the header line", () => {
    const csv = transactionsToCsv([]);
    expect(csv).toBe(EXPORT_CSV_HEADER + "\r\n");
  });

  it("emits one record per transaction with the columns in order", () => {
    const csv = transactionsToCsv([row()]);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe(EXPORT_CSV_HEADER);
    expect(lines[1]).toBe("2026-06-15,-47,EXPENSE,Groceries,Checking,Aldi,");
  });

  it("keeps a negative Amount un-prefixed (Amount uses escapeCsvField)", () => {
    const csv = transactionsToCsv([row({ amount: -47 })]);
    expect(csv).toContain(",-47,");
    expect(csv).not.toContain(",'-47,");
  });

  it("neutralizes a formula in a free-text column (Note uses escapeCsvTextField)", () => {
    const csv = transactionsToCsv([row({ note: "=cmd()" })]);
    expect(csv.trimEnd().endsWith("'=cmd()")).toBe(true);
  });

  it("renders null free-text fields as empty", () => {
    const csv = transactionsToCsv([row({ category: null, merchant: null, note: null })]);
    const dataLine = csv.split("\r\n")[1];
    expect(dataLine).toBe("2026-06-15,-47,EXPENSE,,Checking,,");
  });

  it("round-trips a merchant containing a comma and newline via quoting", () => {
    const csv = transactionsToCsv([row({ merchant: "A, B\nInc" })]);
    expect(csv).toContain('"A, B\nInc"');
  });

  it("does not prepend a BOM", () => {
    const csv = transactionsToCsv([]);
    expect(csv.charCodeAt(0)).not.toBe(0xfeff);
  });

  it("labels a split transaction's Category column 'Split' (one reconciling row)", () => {
    const csv = transactionsToCsv([
      row({
        isSplit: true,
        category: null,
        splits: [
          { categoryId: "c1", amount: 55, note: null },
          { categoryId: "c2", amount: 25, note: null },
        ],
      }),
    ]);
    const dataLine = csv.split("\r\n")[1];
    expect(dataLine).toBe("2026-06-15,-47,EXPENSE,Split,Checking,Aldi,");
  });
});
