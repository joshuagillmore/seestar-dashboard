/**
 * Phone-density breakpoint (design README.md:685–727, "Mobile"). The design's
 * own phone frame is 393px logical width (iPhone 14 Pro) — 600px is Material
 * Design's own compact/medium cutoff, comfortably above real phone widths
 * (~360–430px) and comfortably below small-desktop/tablet windows, so merely
 * narrowing a desktop browser a bit doesn't accidentally trip it, but
 * narrowing it to phone width does (see useMediaQuery.ts's own doc comment
 * for why that's the actual mobile-preview mechanism — no separate toggle).
 */
export const MOBILE_QUERY = '(max-width: 600px)'
