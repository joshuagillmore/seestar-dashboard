import { describe, expect, it } from 'vitest'
import { verdictFor } from './verdict'

describe('verdict mapping', () => {
  it('maps the three values go can hold', () => {
    expect(verdictFor(true)).toBe('GO')
    expect(verdictFor(false)).toBe('NO-GO')
    expect(verdictFor(null)).toBe('UNKNOWN')
  })

  it('never returns CONDITIONAL', () => {
    // CONDITIONAL exists in the design but not in the server contract.
    // Deriving it from `suitability` would be the UI computing a verdict.
    const all = [true, false, null].map(verdictFor)
    expect(all).not.toContain('CONDITIONAL')
  })
})
