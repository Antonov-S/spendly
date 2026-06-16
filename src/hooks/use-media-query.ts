"use client";

import { useEffect, useState } from "react";

/**
 * Subscribe to a CSS media query. Initialized synchronously from `matchMedia`
 * so there is no first-frame flash for client-only consumers (e.g. the drawer,
 * which only renders after a user interaction). Returns `false` during SSR.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(query).matches : false
  );

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
