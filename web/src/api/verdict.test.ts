import { describe, expect, it } from 'vitest'
import { verdictFor } from './verdict'

describe('verdict mapping', () => {
  it('maps the three values go can hold, and nothing else', () => {
    // Exhaustive over the input domain, so no input can produce a fourth
    // verdict. In particular there is no CONDITIONAL: it exists in the design
    // but not in the server contract, and deriving it from `suitability`
    // would be the UI computing a verdict.
    expect(verdictFor(true)).toBe('GO')
    expect(verdictFor(false)).toBe('NO-GO')
    expect(verdictFor(null)).toBe('UNKNOWN')
  })
})
