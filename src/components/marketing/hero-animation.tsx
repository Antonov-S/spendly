"use client";

import { useEffect, useRef, useState } from "react";
import { HERO_ANIMATION } from "@/lib/constants";
import { budgetColor, budgetPercent, budgetState } from "@/lib/budget";
import { MARKETING_BUDGETS } from "@/lib/marketing/dashboard-snapshot";
import {
  cubeKeyframes,
  phaseOffsets,
  HERO_EASING,
  type BarTarget,
} from "@/lib/marketing/hero-choreography";

/**
 * Decorative "Financial Chaos → Clarity" cube overlay that layers on top of the
 * static DashboardPreview after hydration. Pure progressive enhancement: it
 * adds nothing to the server HTML and runs only on the single animated render
 * path (desktop width + motion-OK). Mobile and `prefers-reduced-motion` render
 * nothing here, leaving the static phase-4 dashboard visible.
 *
 * Phases (CSS 3D transforms driven by the Web Animations API):
 *   1. scattered cubes drift (chaos)        2. ease into category columns
 *   3. columns collapse into budget bars     4. cross-fade to the real dashboard
 *
 * Each cube runs two animations: a compositor-only transform/opacity track
 * (smooth motion) and a decoupled color track (grey → green). The keyframe math
 * lives in `@/lib/marketing/hero-choreography`; this component is just the
 * driver — visibility gating, play/replay, and lifecycle.
 *
 * Plays once ~`startDelayMs` after the hero is first visible, holds on the
 * revealed dashboard, and replays only when the hero re-enters the viewport.
 */
/**
 * Measure the first `budgetRows` real budget bars (the inert `data-budget-track`
 * elements rendered by BudgetsPanel) relative to the overlay, pairing each with
 * its snapshot budget for fill + color. Returns `undefined` when the expected
 * bars aren't found, so the choreography falls back to centered bars.
 */
function measureBudgetBars(overlay: HTMLElement): BarTarget[] | undefined {
  const stage = overlay.parentElement;
  if (!stage) return undefined;

  const tracks = Array.from(
    stage.querySelectorAll<HTMLElement>("[data-budget-track]")
  ).slice(0, HERO_ANIMATION.budgetRows);
  if (tracks.length < HERO_ANIMATION.budgetRows) return undefined;

  const overlayRect = overlay.getBoundingClientRect();
  return tracks.map((track, i) => {
    const rect = track.getBoundingClientRect();
    const budget = MARKETING_BUDGETS[i];
    return {
      left: rect.left - overlayRect.left,
      top: rect.top - overlayRect.top,
      width: rect.width,
      height: rect.height,
      fill: budgetPercent(budget.spent, budget.limit) / 100,
      color: budgetColor(budgetState(budget.spent, budget.limit)),
    };
  });
}

export function HeroAnimation() {
  const overlayRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const cubeRefs = useRef<(HTMLDivElement | null)[]>([]);
  const animationsRef = useRef<Animation[]>([]);
  const playTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playedRef = useRef(false);

  // Only the desktop + motion-OK path renders cubes; everyone else keeps the
  // static dashboard. Decided once after mount (no SSR/hydration divergence).
  const [active, setActive] = useState(false);

  useEffect(() => {
    const wideEnough = window.matchMedia(
      `(min-width: ${HERO_ANIMATION.desktopMinWidth}px)`
    ).matches;
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
    if (wideEnough && !reduceMotion) setActive(true);
  }, []);

  useEffect(() => {
    if (!active) return;
    const overlay = overlayRef.current;
    const scrim = scrimRef.current;
    if (!overlay || !scrim) return;

    const cancelAnimations = () => {
      animationsRef.current.forEach((a) => a.cancel());
      animationsRef.current = [];
    };

    const play = () => {
      const w = overlay.clientWidth;
      const h = overlay.clientHeight;
      if (w === 0 || h === 0) return;
      cancelAnimations();

      const p = phaseOffsets();
      const barTargets = measureBudgetBars(overlay);
      // Per-keyframe easing carries the motion; the color track lerps linearly.
      const motionOptions: KeyframeAnimationOptions = {
        duration: p.total,
        fill: "forwards",
      };
      const colorOptions: KeyframeAnimationOptions = {
        duration: p.total,
        easing: "linear",
        fill: "forwards",
      };

      cubeRefs.current.forEach((cube, i) => {
        if (!cube) return;
        const { motion, color } = cubeKeyframes(i, w, h, p, barTargets);
        animationsRef.current.push(cube.animate(motion, motionOptions));
        animationsRef.current.push(cube.animate(color, colorOptions));
      });

      // Scrim holds opaque through chaos (linear offsets keep that honest),
      // then soft-fades only across the o3 -> 1 reveal segment.
      animationsRef.current.push(
        scrim.animate(
          [
            { offset: 0, opacity: 1 },
            { offset: p.o3, opacity: 1, easing: HERO_EASING.out },
            { offset: 1, opacity: 0 },
          ],
          { duration: p.total, fill: "forwards" }
        )
      );

      // Soft fade-in of the whole overlay so the dashboard→chaos start reads as
      // a quick cross-fade, not a hard cut.
      animationsRef.current.push(
        overlay.animate([{ opacity: 0 }, { opacity: 1 }], {
          duration: HERO_ANIMATION.introFadeMs,
          easing: HERO_EASING.out,
          fill: "forwards",
        })
      );
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          if (!playedRef.current) {
            playedRef.current = true;
            playTimerRef.current = setTimeout(play, HERO_ANIMATION.startDelayMs);
          }
        } else {
          // Reset so a later re-entry replays from phase 1.
          playedRef.current = false;
          if (playTimerRef.current) clearTimeout(playTimerRef.current);
          cancelAnimations();
        }
      },
      { threshold: 0.4 }
    );
    observer.observe(overlay);

    return () => {
      observer.disconnect();
      if (playTimerRef.current) clearTimeout(playTimerRef.current);
      cancelAnimations();
    };
  }, [active]);

  return (
    <div
      ref={overlayRef}
      aria-hidden
      className="hero-stage pointer-events-none absolute inset-0"
      // Single source of truth for cube size: the constant drives CSS geometry.
      style={
        { "--cube-size": `${HERO_ANIMATION.cubeSizePx}px` } as React.CSSProperties
      }
    >
      <div
        ref={scrimRef}
        className="absolute inset-0 rounded-xl bg-app opacity-0"
      />
      {active &&
        Array.from({ length: HERO_ANIMATION.cubeCount }, (_, i) => (
          <div
            key={i}
            ref={(el) => {
              cubeRefs.current[i] = el;
            }}
            className="hero-cube"
          >
            <span className="hero-cube__face hero-cube__face--front" />
            <span className="hero-cube__face hero-cube__face--top" />
            <span className="hero-cube__face hero-cube__face--right" />
          </div>
        ))}
    </div>
  );
}
