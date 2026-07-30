import { beforeEach, describe, expect, it } from 'vitest'
import { readSelectedProjectId, writeSelectedProjectId } from './selection'

beforeEach(() => localStorage.clear())

describe('selection (localStorage-persisted view preference)', () => {
  it('reads null when nothing has ever been selected', () => {
    expect(readSelectedProjectId()).toBeNull()
  })

  it('reads back exactly what was written', () => {
    writeSelectedProjectId('M31')
    expect(readSelectedProjectId()).toBe('M31')
  })

  it('survives being read again later — the point of persisting at all', () => {
    writeSelectedProjectId('IC405')
    // A fresh read (no shared in-memory state, only localStorage) still sees it.
    expect(readSelectedProjectId()).toBe('IC405')
  })

  it('overwrites the previous selection rather than accumulating one', () => {
    writeSelectedProjectId('M31')
    writeSelectedProjectId('M42')
    expect(readSelectedProjectId()).toBe('M42')
  })

  it('degrades to null, without throwing, when localStorage holds non-JSON junk', () => {
    localStorage.setItem('seestar-dashboard:selected-project:v1', 'not json at all {')
    expect(() => readSelectedProjectId()).not.toThrow()
    expect(readSelectedProjectId()).toBeNull()
  })

  it('degrades to null when the stored JSON parses but is not a string', () => {
    localStorage.setItem('seestar-dashboard:selected-project:v1', JSON.stringify({ id: 'M31' }))
    expect(readSelectedProjectId()).toBeNull()
    localStorage.setItem('seestar-dashboard:selected-project:v1', JSON.stringify(42))
    expect(readSelectedProjectId()).toBeNull()
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
      expect(() => writeSelectedProjectId('M31')).not.toThrow()
      expect(() => readSelectedProjectId()).not.toThrow()
      expect(readSelectedProjectId()).toBeNull() // couldn't persist, so still null
    } finally {
      if (original) Object.defineProperty(window, 'localStorage', original)
    }
  })
})
