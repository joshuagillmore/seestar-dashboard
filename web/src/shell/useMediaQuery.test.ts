import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMediaQuery } from './useMediaQuery'

afterEach(() => vi.unstubAllGlobals())

describe('useMediaQuery', () => {
  it('is false when window.matchMedia does not exist at all (jsdom\'s real default)', () => {
    // Deliberately NOT stubbing matchMedia here — this is what every other
    // test in the suite gets by default, and it must not throw.
    const { result } = renderHook(() => useMediaQuery('(max-width: 600px)'))
    expect(result.current).toBe(false)
  })

  it('reads the initial match from matchMedia, not just from a later event', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: true,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    )
    const { result } = renderHook(() => useMediaQuery('(max-width: 600px)'))
    expect(result.current).toBe(true)
  })

  it('updates when the query list fires a change event — a real breakpoint crossing, not just the value at mount', () => {
    let changeHandler: ((event: { matches: boolean }) => void) | null = null
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: false,
        media: query,
        addEventListener: vi.fn((type: string, handler: (event: { matches: boolean }) => void) => {
          if (type === 'change') changeHandler = handler
        }),
        removeEventListener: vi.fn(),
      })),
    )
    const { result } = renderHook(() => useMediaQuery('(max-width: 600px)'))
    expect(result.current).toBe(false)

    act(() => {
      changeHandler?.({ matches: true })
    })
    expect(result.current).toBe(true)
  })

  it('falls back to addListener/removeListener for a matchMedia mock without the modern EventTarget methods', () => {
    // Some Safari <14-shaped mocks (and this repo's own stubMatchMedia helper
    // is deliberately the modern shape) only implement the legacy pair —
    // this must not throw when addEventListener is absent.
    const addListener = vi.fn()
    const removeListener = vi.fn()
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) => ({
        matches: false,
        media: query,
        addListener,
        removeListener,
      })),
    )
    const { unmount } = renderHook(() => useMediaQuery('(max-width: 600px)'))
    expect(addListener).toHaveBeenCalledTimes(1)
    unmount()
    expect(removeListener).toHaveBeenCalledTimes(1)
  })
})
