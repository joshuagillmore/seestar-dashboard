import { describe, expect, it } from 'vitest'
import { targetTypeLabel } from './targetType'

describe('targetTypeLabel', () => {
  it('maps every server TARGET_TYPES value to the design\'s coarse family label', () => {
    expect(targetTypeLabel('emission_nebula')).toBe('nebula')
    expect(targetTypeLabel('planetary_nebula')).toBe('nebula')
    expect(targetTypeLabel('reflection_nebula')).toBe('nebula')
    expect(targetTypeLabel('supernova_remnant')).toBe('nebula')
    expect(targetTypeLabel('galaxy')).toBe('galaxy')
    expect(targetTypeLabel('open_cluster')).toBe('cluster')
    expect(targetTypeLabel('globular_cluster')).toBe('cluster')
    expect(targetTypeLabel('other')).toBe('other')
  })

  it('never renders snake_case — no mapped label contains an underscore', () => {
    const inputs = [
      'emission_nebula', 'planetary_nebula', 'reflection_nebula',
      'supernova_remnant', 'galaxy', 'open_cluster', 'globular_cluster', 'other',
    ]
    for (const type of inputs) {
      expect(targetTypeLabel(type)).not.toMatch(/_/)
    }
  })

  it('falls through an unrecognised type to a legible label instead of blank', () => {
    // Neither invented nor blank: an unmapped/future type must still render
    // something, with underscores swapped for spaces rather than dropped —
    // this is a staleness fallback, not a design decision about the type.
    expect(targetTypeLabel('dark_nebula')).toBe('dark nebula')
    expect(targetTypeLabel('')).toBe('')
  })
})
