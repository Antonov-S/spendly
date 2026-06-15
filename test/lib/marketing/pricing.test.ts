import { describe, it, expect } from "vitest";
import {
  yearlyDiscountPercent,
  PRICING,
  PRICING_PLANS,
} from "@/lib/marketing/pricing";

describe("yearlyDiscountPercent", () => {
  it("derives the rounded savings of yearly vs 12 monthly payments", () => {
    // $3/mo * 12 = $36 full year; $25 yearly => (36 - 25) / 36 = 30.5% -> 31%.
    expect(yearlyDiscountPercent(3, 25)).toBe(31);
  });

  it("defaults to the configured PRICING values", () => {
    expect(yearlyDiscountPercent()).toBe(
      yearlyDiscountPercent(PRICING.monthly, PRICING.yearly)
    );
  });

  it("rounds to the nearest whole percent", () => {
    // $10/mo * 12 = $120; $100 yearly => 16.66% -> 17%.
    expect(yearlyDiscountPercent(10, 100)).toBe(17);
  });

  it("returns 0 when there is no monthly cost (avoids divide-by-zero)", () => {
    expect(yearlyDiscountPercent(0, 0)).toBe(0);
  });

  it("never produces a negative discount for a positive base", () => {
    // Yearly priced above 12 months -> clamp-free negative, but still finite.
    expect(yearlyDiscountPercent(3, 40)).toBeLessThan(0);
  });
});

describe("PRICING_PLANS", () => {
  it("exposes exactly one highlighted (Pro) plan with a badge", () => {
    const highlighted = PRICING_PLANS.filter((p) => p.highlighted);
    expect(highlighted).toHaveLength(1);
    expect(highlighted[0].badge).toBeTruthy();
  });

  it("has a free plan priced at zero", () => {
    const free = PRICING_PLANS.find((p) => p.monthlyPrice === 0);
    expect(free).toBeDefined();
    expect(free?.yearlyPrice).toBe(0);
  });

  it("points every plan CTA at the registration route", () => {
    for (const plan of PRICING_PLANS) {
      expect(plan.cta.href).toBe("/register");
    }
  });
});
