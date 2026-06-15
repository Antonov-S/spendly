import { HERO_ANIMATION, HERO_CUBE_COLORS } from "@/lib/constants";
import { SEMANTIC_COLORS } from "@/lib/system-constants";

/**
 * Pure choreography for the homepage hero cube animation — the keyframe math,
 * with no DOM. Kept out of the component so it can be unit-tested and so the
 * Web Animations layer (hero-animation.tsx) is a thin driver over it.
 *
 * Phases: 1 scattered chaos → 2 category columns → 3 budget bars → 4 reveal.
 */

/** Cubic-bezier easings for the cube motion. */
export const HERO_EASING = {
  inOut: "cubic-bezier(0.45, 0, 0.55, 1)",
  /** Slight overshoot/settle — the "magnetic" categorize motion. */
  magnetic: "cubic-bezier(0.34, 1.26, 0.55, 1)",
  /** Soft ease-out for the final settle into bars + the dashboard reveal. */
  out: "cubic-bezier(0.22, 1, 0.36, 1)",
} as const;

/** Base settled orientation (isometric read); jittered slightly per cube. */
const ISO_BASE = { x: -22, y: 32 };

/** Where, within phase 1, the cube reaches the top of its floating arc. */
const PHASE1_FLOAT_FRACTION = 0.5;

/**
 * Fallback per-budget-bar fill fraction and color, used when the live budget
 * bars can't be measured. One amber row nears its limit. When the real bars are
 * available the component supplies measured `BarTarget`s instead.
 */
export const BAR_ROWS = [
  { fill: 0.55, color: SEMANTIC_COLORS.success },
  { fill: 0.85, color: SEMANTIC_COLORS.warning },
  { fill: 0.45, color: SEMANTIC_COLORS.success },
  { fill: 0.7, color: SEMANTIC_COLORS.success },
] as const;

/**
 * A real on-screen budget bar (measured relative to the cube overlay) that a
 * row of cubes should collapse onto, so the bars morph into the actual
 * dashboard component rather than dissolving from a centered position.
 */
export interface BarTarget {
  left: number;
  top: number;
  width: number;
  height: number;
  /** Filled fraction of the bar (0–1) — drives how many cubes land on it. */
  fill: number;
  color: string;
}

/** Injectable 0–1 random source so the choreography is deterministic in tests. */
export type Rng = () => number;

export interface PhaseOffsets {
  /** Keyframe offsets (0–1) marking the end of each phase. */
  o1: number;
  o2: number;
  o3: number;
  /** Full motion duration (ms) the offsets are relative to. */
  total: number;
}

/** Derive the phase-boundary offsets from the configured phase durations. */
export function phaseOffsets(): PhaseOffsets {
  const { phase1DriftMs, phase2GroupMs, phase3StackMs, revealMs } =
    HERO_ANIMATION;
  const total = phase1DriftMs + phase2GroupMs + phase3StackMs + revealMs;
  return {
    o1: phase1DriftMs / total,
    o2: (phase1DriftMs + phase2GroupMs) / total,
    o3: (phase1DriftMs + phase2GroupMs + phase3StackMs) / total,
    total,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function transform(x: number, y: number, z: number, rotation: string): string {
  return `translate3d(${x}px, ${y}px, ${z}px) ${rotation}`;
}

/**
 * Keyframes for one cube, split into two tracks so the component can run them
 * as separate animations:
 *   - `motion` (transform + opacity) stays entirely on the compositor — no
 *     paint, so the movement is smooth regardless of color cost.
 *   - `color` is decoupled (grey → green repaints the faces) and can never
 *     stall the motion.
 *
 * When `barTargets` is supplied, phase 3 lays each row onto the matching real
 * budget bar (position, width, fill, color) so it morphs into the dashboard;
 * otherwise it falls back to centered bars built from `BAR_ROWS`.
 */
export interface CubeKeyframes {
  motion: Keyframe[];
  color: Keyframe[];
}

export function cubeKeyframes(
  index: number,
  w: number,
  h: number,
  p: PhaseOffsets,
  barTargets?: BarTarget[],
  rng: Rng = Math.random
): CubeKeyframes {
  const { cubeSizePx, cubeCount, groupColumns, budgetRows } = HERO_ANIMATION;
  const s = cubeSizePx;
  const rand = (min: number, max: number) => min + rng() * (max - min);

  // Per-cube stagger so the group/collapse don't snap in lockstep.
  const stagger = rand(-0.03, 0.03);
  const o1 = clamp(p.o1 + stagger, 0.05, p.o2 - 0.05);
  const o2 = clamp(p.o2 + stagger, o1 + 0.05, p.o3 - 0.05);
  const o3 = clamp(p.o3 + stagger, o2 + 0.05, 0.95);
  const oFloat = o1 * PHASE1_FLOAT_FRACTION;

  // Phase 1 — scattered chaos with a slow, subtle tumble: the rotation only
  // drifts a little from its base pose, and z stays shallow, so cubes turn
  // gently instead of flickering.
  const x0 = rand(0, w - s);
  const y0 = rand(0, h - s);
  const z0 = rand(-90, 90);
  const baseRx = rand(-180, 180);
  const baseRy = rand(-180, 180);
  const baseRz = rand(-180, 180);
  const rot0 = `rotateX(${baseRx}deg) rotateY(${baseRy}deg) rotateZ(${baseRz}deg)`;
  const x1 = clamp(x0 + rand(-18, 18), 0, w - s);
  const y1 = clamp(y0 + rand(-18, 18), 0, h - s);
  const z1 = clamp(z0 + rand(-28, 28), -90, 90);
  const rot1 = `rotateX(${baseRx + rand(-28, 28)}deg) rotateY(${baseRy + rand(-28, 28)}deg) rotateZ(${baseRz + rand(-28, 28)}deg)`;

  // Floating midpoint within phase 1: a gentle upward arc + the smallest of
  // rotation drift, so cubes drift like they're suspended rather than sliding.
  const xm = clamp((x0 + x1) / 2 + rand(-12, 12), 0, w - s);
  const ym = clamp((y0 + y1) / 2 - rand(8, 18), 0, h - s);
  const zm = clamp((z0 + z1) / 2 + rand(-20, 20), -90, 90);
  const rotm = `rotateX(${baseRx + rand(-14, 14)}deg) rotateY(${baseRy + rand(-14, 14)}deg) rotateZ(${baseRz + rand(-14, 14)}deg)`;

  // Settled orientation, nudged a few degrees per cube so columns and bars
  // don't look mechanically identical.
  const iso = `rotateX(${ISO_BASE.x + rand(-5, 5)}deg) rotateY(${ISO_BASE.y + rand(-5, 5)}deg)`;

  // Phase 2 — neat category columns.
  const col = index % groupColumns;
  const rowInCol = Math.floor(index / groupColumns);
  const rowsPerCol = Math.ceil(cubeCount / groupColumns);
  const colGap = s + 10;
  const rowGap = s + 6;
  const gridW = groupColumns * colGap - 10;
  const gridH = rowsPerCol * rowGap - 6;
  const x2 = (w - gridW) / 2 + col * colGap;
  const y2 = (h - gridH) / 2 + rowInCol * rowGap;

  // Phase 3 — collapse columns into horizontal budget bars.
  const row = index % budgetRows;
  const orderInRow = Math.floor(index / budgetRows);
  const cubesPerRow = Math.ceil(cubeCount / budgetRows);
  const target = barTargets?.[row];

  let x3: number;
  let y3: number;
  let barColor: string;
  let filled: boolean;
  if (target) {
    // Land the row onto the real budget bar so it morphs into the dashboard.
    const fillCount = Math.max(1, Math.round(target.fill * cubesPerRow));
    filled = orderInRow < fillCount;
    const spacing = (target.width * target.fill) / fillCount;
    x3 = target.left + orderInRow * spacing;
    y3 = target.top + target.height / 2 - s / 2;
    barColor = target.color;
  } else {
    // Centered fallback when the live bars can't be measured.
    const bar = BAR_ROWS[row];
    const step = s + 2;
    const barGapY = s + 18;
    const barsH = budgetRows * barGapY - 18;
    const barLeft = (w - cubesPerRow * step) / 2;
    x3 = barLeft + orderInRow * step;
    y3 = (h - barsH) / 2 + row * barGapY;
    barColor = bar.color;
    filled = orderInRow < Math.round(bar.fill * cubesPerRow);
  }

  const motion: Keyframe[] = [
    {
      offset: 0,
      transform: transform(x0, y0, z0, rot0),
      opacity: 1,
      easing: HERO_EASING.inOut,
    },
    {
      offset: oFloat,
      transform: transform(xm, ym, zm, rotm),
      opacity: 1,
      easing: HERO_EASING.inOut,
    },
    {
      offset: o1,
      transform: transform(x1, y1, z1, rot1),
      opacity: 1,
      easing: HERO_EASING.magnetic,
    },
    {
      offset: o2,
      transform: transform(x2, y2, 0, iso),
      opacity: 1,
      easing: HERO_EASING.out,
    },
    {
      offset: o3,
      transform: transform(x3, y3, 0, iso),
      // Cubes beyond a row's fill melt away as the bar consolidates.
      opacity: filled ? 1 : 0,
      easing: HERO_EASING.out,
    },
    {
      offset: 1,
      transform: transform(x3, y3, 0, iso),
      opacity: 0,
    },
  ];

  const color: Keyframe[] = [
    { offset: 0, color: HERO_CUBE_COLORS.chaos },
    { offset: o1, color: HERO_CUBE_COLORS.chaos },
    { offset: o2, color: HERO_CUBE_COLORS.transition },
    { offset: o3, color: barColor },
    { offset: 1, color: barColor },
  ];

  return { motion, color };
}
