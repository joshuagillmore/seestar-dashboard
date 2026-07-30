import { beforeEach, describe, expect, it } from 'vitest'
import { isGoalDoubled, toggleGoalDoubled } from './doubling'

beforeEach(() => localStorage.clear())

describe('doubling (localStorage-persisted view preference)', () => {
  it('defaults to not doubled for a target never toggled', () => {
    expect(isGoalDoubled('M31')).toBe(false)
  })

  it('toggling flips the flag and returns the new value', () => {
    expect(toggleGoalDoubled('M31')).toBe(true)
    expect(isGoalDoubled('M31')).toBe(true)
    expect(toggleGoalDoubled('M31')).toBe(false)
    expect(isGoalDoubled('M31')).toBe(false)
  })

  it('persists across separate reads, keyed independently per target', () => {
    toggleGoalDoubled('M31')
    expect(isGoalDoubled('M31')).toBe(true)
    expect(isGoalDoubled('M42')).toBe(false) // a different target is unaffected
  })

  it('survives being read again later — the point of persisting at all', () => {
    toggleGoalDoubled('IC405')
    // A fresh read (no shared in-memory state, only localStorage) still sees it.
    expect(isGoalDoubled('IC405')).toBe(true)
  })

  it('degrades to false, without throwing, when localStorage holds non-JSON junk', () => {
    localStorage.setItem('seestar-dashboard:doubled-goals:v1', 'not json at all {')
    expect(() => isGoalDoubled('M31')).not.toThrow()
    expect(isGoalDoubled('M31')).toBe(false)
  })

  it('degrades to false, without throwing, when the stored JSON is not an array', () => {
    localStorage.setItem('seestar-dashboard:doubled-goals:v1', JSON.stringify({ M31: true }))
    expect(isGoalDoubled('M31')).toBe(false)
  })

  it('ignores non-string entries in an otherwise-valid array rather than crashing', () => {
    localStorage.setItem('seestar-dashboard:doubled-goals:v1', JSON.stringify(['M31', 42, null, 'M42']))
    expect(isGoalDoubled('M31')).toBe(true)
    expect(isGoalDoubled('M42')).toBe(true)
  })

  it('does not throw and simply fails to persist when localStorage access itself throws', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage')
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('blocked')
      },
    })
    try {
      expect(() => toggleGoalDoubled('M31')).not.toThrow()
      expect(isGoalDoubled('M31')).toBe(false) // couldn't persist, so still false
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original)
    }
  })
})
