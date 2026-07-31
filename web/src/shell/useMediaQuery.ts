import { useEffect, useState } from 'react'

/**
 * Tracks whether a media query currently matches, re-rendering the caller on
 * every breakpoint crossing — not just on mount. This is what lets a desktop
 * browser preview the mobile layout for free: narrow the window past
 * `MOBILE_QUERY` (see breakpoints.ts) and the same running app re-renders
 * into the mobile screens, no separate toggle needed.
 *
 * jsdom (the test environment) does not implement `window.matchMedia` at all
 * — confirmed directly (`typeof window.matchMedia === 'undefined'` in this
 * repo's pinned jsdom 30) — so every check here is defensive: a caller that
 * never touches this hook keeps working exactly as before, and a test that
 * wants a mobile-width render stubs `window.matchMedia` explicitly (see
 * MobileTonightView.test.tsx / MobileLiveView.test.tsx for the pattern).
 */
export function useMediaQuery(query: string): boolean {
  const getMatches = (): boolean =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false

  const [matches, setMatches] = useState(getMatches)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const handler = (event: MediaQueryListEvent) => setMatches(event.matches)
    setMatches(mql.matches)
    // addEventListener is the standard API; addListener is the Safari <14
    // fallback some jsdom mocks in this codebase's own tests may still use.
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', handler)
      return () => mql.removeEventListener('change', handler)
    }
    mql.addListener(handler)
    return () => mql.removeListener(handler)
  }, [query])

  return matches
}
