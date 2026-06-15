import { describe, it, expect } from "vitest";
import {
  phaseOffsets,
  cubeKeyframes,
  BAR_ROWS,
  type BarTarget,
  type Rng,
} from "@/lib/marketing/hero-choreography";
import { HERO_ANIMATION, HERO_CUBE_COLORS } from "@/lib/constants";
import { SEMANTIC_COLORS } from "@/lib/system-constants";

/** rng that always returns 0.5 -> stagger of 0, so offsets equal the phase values. */
const midRng: Rng = () => 0.5;

const W = 1000;
const H = 800;

describe("phaseOffsets", () => {
  it("totals the four phase durations", () => {
    const { total } = phaseOffsets();
    const { phase1DriftMs, phase2GroupMs, phase3StackMs, revealMs } =
      HERO_ANIMATION;
    expect(total).toBe(phase1DriftMs + phase2GroupMs + phase3StackMs + revealMs);
  });

  it("returns boundaries in ascending order within (0, 1)", () => {
    const { o1, o2, o3 } = phaseOffsets();
    expect(o1).toBeGreaterThan(0);
    expect(o1).toBeLessThan(o2);
    expect(o2).toBeLessThan(o3);
    expect(o3).toBeLessThan(1);
  });
});

describe("cubeKeyframes", () => {
  const p = phaseOffsets();

  it("returns 6 motion (incl. the phase-1 float) and 5 color keyframes", () => {
    const { motion, color } = cubeKeyframes(0, W, H, p, undefined, midRng);
    expect(motion).toHaveLength(6);
    expect(color).toHaveLength(5);
  });

  it("with a zero-stagger rng, offsets match the phase boundaries", () => {
    const { motion } = cubeKeyframes(0, W, H, p, undefined, midRng);
    // The second keyframe is the floating midpoint of phase 1 (o1 * 0.5).
    expect(motion.map((k) => k.offset)).toEqual([
      0,
      p.o1 * 0.5,
      p.o1,
      p.o2,
      p.o3,
      1,
    ]);
  });

  it("starts fully visible and ends faded out (the reveal)", () => {
    const { motion } = cubeKeyframes(0, W, H, p, undefined, midRng);
    expect(motion[0].opacity).toBe(1);
    expect(motion[5].opacity).toBe(0);
  });

  it("progresses color from grey through the transition to the bar color", () => {
    const { color } = cubeKeyframes(0, W, H, p, undefined, midRng);
    expect(color[0].color).toBe(HERO_CUBE_COLORS.chaos);
    expect(color[1].color).toBe(HERO_CUBE_COLORS.chaos);
    expect(color[2].color).toBe(HERO_CUBE_COLORS.transition);
    expect(color[3].color).toBe(SEMANTIC_COLORS.success);
    expect(color[4].color).toBe(SEMANTIC_COLORS.success);
  });

  it("assigns the amber color to cubes in the warning row (centered fallback)", () => {
    // budgetRows = 4; BAR_ROWS[1] is the amber row, so index % 4 === 1.
    const warningRow = BAR_ROWS.findIndex(
      (r) => r.color === SEMANTIC_COLORS.warning
    );
    const { color } = cubeKeyframes(warningRow, W, H, p, undefined, midRng);
    expect(color[3].color).toBe(SEMANTIC_COLORS.warning);
  });

  it("keeps cubes within a row's fill visible and melts the rest at the bar", () => {
    // Row 0 fill 0.55 over 20 cubes/row -> 11 filled. orderInRow = floor(i/4).
    // The o3 keyframe (bar position) is index 4.
    const filled = cubeKeyframes(0, W, H, p, undefined, midRng); // orderInRow 0
    const unfilled = cubeKeyframes(44, W, H, p, undefined, midRng); // orderInRow 11
    expect(filled.motion[4].opacity).toBe(1);
    expect(unfilled.motion[4].opacity).toBe(0);
  });

  it("emits valid translate3d transforms on every motion keyframe", () => {
    const { motion } = cubeKeyframes(7, W, H, p, undefined, midRng);
    for (const k of motion) {
      expect(String(k.transform)).toMatch(/^translate3d\(/);
    }
  });

  it("keeps offsets ordered and in range for extreme stagger values", () => {
    for (const rng of [() => 0, () => 1] as Rng[]) {
      const { motion } = cubeKeyframes(3, W, H, p, undefined, rng);
      const offsets = motion.map((k) => k.offset as number);
      expect(offsets[0]).toBe(0);
      expect(offsets[5]).toBe(1);
      for (let i = 1; i < offsets.length; i++) {
        expect(offsets[i]).toBeGreaterThan(offsets[i - 1]);
        expect(offsets[i]).toBeLessThanOrEqual(1);
      }
    }
  });

  it("lands cubes on the supplied budget bar (position, color, fill)", () => {
    const targets: BarTarget[] = Array.from({ length: 4 }, (_, r) => ({
      left: 100 + r,
      top: 200 + r * 30,
      width: 250,
      height: 4,
      fill: 0.5,
      color: "#abcdef",
    }));
    const { motion, color } = cubeKeyframes(0, W, H, p, targets, midRng); // row 0
    // The o3 (bar) keyframe sits at the bar's left edge for the first cube.
    expect(String(motion[4].transform)).toMatch(/^translate3d\(100px,/);
    expect(color[3].color).toBe("#abcdef");
    // fill 0.5 * 20 = 10 filled; orderInRow 0 is within the fill.
    expect(motion[4].opacity).toBe(1);
  });
});
