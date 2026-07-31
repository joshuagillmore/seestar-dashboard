import { vi } from 'vitest'

/**
 * jsdom (this repo's test environment) does not implement `window.matchMedia`
 * at all — confirmed directly against the pinned jsdom 30 (`typeof
 * window.matchMedia === 'undefined'`) — so `useMediaQuery` treats every query
 * as non-matching unless a test stubs it explicitly. This is that stub:
 * a fixed `matches` value (this suite never needs the mid-test resize case,
 * only "is the mobile breakpoint active for this render"), with real
 * add/removeEventListener no-ops so `useMediaQuery`'s cleanup effect doesn't
 * throw calling them.
 *
 * `vi.unstubAllGlobals()` (already called in every affected test file's
 * `afterEach`, for the `fetch` stub) undoes this too.
 */
export function stubMatchMedia(matches: boolean): void {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  )
}
