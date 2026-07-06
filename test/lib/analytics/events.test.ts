import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  ANALYTICS_EVENTS,
  bucketCount,
  sanitizeProps,
} from "@/lib/analytics/events";

describe("sanitizeProps", () => {
  it("drops an unregistered event name", () => {
    const res = sanitizeProps("not_a_real_event", { foo: 1 });
    expect(res).toEqual({ ok: false, reason: "unregistered_event" });
  });

  it("keeps registered keys with valid values", () => {
    const res = sanitizeProps("transaction_created", {
      type: "EXPENSE",
      isSplit: false,
      tagCount: 2,
    });
    expect(res).toEqual({
      ok: true,
      props: { type: "EXPENSE", isSplit: false, tagCount: 2 },
    });
  });

  it("strips an unregistered prop key", () => {
    const res = sanitizeProps("budget_created", {
      rollover: true,
      merchant: "Whole Foods", // not registered
    } as never);
    expect(res).toEqual({ ok: true, props: { rollover: true } });
  });

  it("strips a value that is not in the declared enum tuple", () => {
    const res = sanitizeProps("transaction_created", {
      type: "TRANSFER", // registry only allows INCOME/EXPENSE
    } as never);
    expect(res).toEqual({ ok: true, props: {} });
  });

  it("strips a wrong-typed value", () => {
    const res = sanitizeProps("transaction_created", {
      tagCount: "3", // should be a number
    } as never);
    expect(res).toEqual({ ok: true, props: {} });
  });

  it("strips an over-long or non-slug string prop", () => {
    const longCode = "a".repeat(200);
    const res = sanitizeProps("ai_parse_confirmed", {
      edited_fields: longCode,
    } as never);
    expect(res).toEqual({ ok: true, props: {} });

    const prose = sanitizeProps("ai_parse_confirmed", {
      edited_fields: "lunch at Pret", // whitespace/prose → stripped
    } as never);
    expect(prose).toEqual({ ok: true, props: {} });
  });

  it("keeps a slug-shaped comma-separated code list", () => {
    const res = sanitizeProps("ai_parse_confirmed", {
      edited: true,
      edited_field_count: 2,
      edited_fields: "amount,category",
    });
    expect(res).toEqual({
      ok: true,
      props: { edited: true, edited_field_count: 2, edited_fields: "amount,category" },
    });
  });

  it("keeps ai_result token counts and model slug props", () => {
    const res = sanitizeProps("ai_result", {
      feature: "category_suggest",
      prompt_version: 1,
      outcome: "ok",
      reason: "ok",
      input_tokens: 123,
      output_tokens: 45,
      model: "gpt-5-nano",
    });

    expect(res).toEqual({
      ok: true,
      props: {
        feature: "category_suggest",
        prompt_version: 1,
        outcome: "ok",
        reason: "ok",
        input_tokens: 123,
        output_tokens: 45,
        model: "gpt-5-nano",
      },
    });
  });
});

describe("bucketCount", () => {
  it("maps counts to ordinal buckets at the boundaries", () => {
    expect(bucketCount(0)).toBe("0");
    expect(bucketCount(1)).toBe("1-10");
    expect(bucketCount(10)).toBe("1-10");
    expect(bucketCount(11)).toBe("11-100");
    expect(bucketCount(100)).toBe("11-100");
    expect(bucketCount(101)).toBe("101-1000");
    expect(bucketCount(1000)).toBe("101-1000");
    expect(bucketCount(1001)).toBe("1000+");
  });

  it("treats negative counts as zero", () => {
    expect(bucketCount(-5)).toBe("0");
  });
});

// ─── Structural: every emitted event name is registered ───────────────────
// Walk production source only (src/**, excluding generated Prisma client),
// extract each track("<literal>") first argument, and assert it is a
// registered event. Fails the moment someone emits an unregistered event or
// uses a non-literal event name.

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "generated") continue; // Prisma client output
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Extract the first-argument substring of every `track(` call in `src`,
 * tracking bracket depth and string state so a `,` inside the props object
 * never ends the scan early.
 */
function firstArgsOfTrackCalls(src: string): string[] {
  const args: string[] = [];
  const marker = /\btrack\(/g;
  let m: RegExpExecArray | null;
  while ((m = marker.exec(src)) !== null) {
    let i = m.index + m[0].length;
    let depth = 0;
    let str: string | null = null;
    const start = i;
    for (; i < src.length; i++) {
      const c = src[i];
      if (str) {
        if (c === "\\") i++;
        else if (c === str) str = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") str = c;
      else if ("([{".includes(c)) depth++;
      else if (")]}".includes(c)) {
        if (depth === 0) break; // closing track( with a single arg
        depth--;
      } else if (c === "," && depth === 0) break; // end of first arg
    }
    args.push(src.slice(start, i).trim());
  }
  return args;
}

describe("track() emit-site registration", () => {
  const files = walk(join(process.cwd(), "src"));
  const STRING_LITERAL = /["'`]([\w.]+)["'`]/g;

  it("emits only registered, string-literal event names", () => {
    const unregistered: string[] = [];
    const nonLiteral: string[] = [];

    for (const file of files) {
      if (file.endsWith(join("analytics", "track.ts"))) continue; // definition
      const src = readFileSync(file, "utf8");
      for (const arg of firstArgsOfTrackCalls(src)) {
        if (arg === "") continue;
        // Drop string literals that are comparison operands (e.g.
        // `outcome === "accepted"`) so only event-name-position literals in a
        // ternary remain.
        const cleaned = arg
          .replace(/["'`][\w.]+["'`]\s*[=!]==?/g, "")
          .replace(/[=!]==?\s*["'`][\w.]+["'`]/g, "");
        const names = [...cleaned.matchAll(STRING_LITERAL)].map((x) => x[1]);
        if (names.length === 0) {
          nonLiteral.push(`${arg} (${file})`);
          continue;
        }
        // A ternary of two literals (accept/dismiss) is fine — every literal
        // must resolve to a registered event; a template string leaves a `${`.
        if (cleaned.includes("${")) {
          nonLiteral.push(`${arg} (${file})`);
          continue;
        }
        for (const name of names) {
          if (!(name in ANALYTICS_EVENTS)) {
            unregistered.push(`${name} (${file})`);
          }
        }
      }
    }

    expect(unregistered).toEqual([]);
    expect(nonLiteral).toEqual([]);
  });
});
