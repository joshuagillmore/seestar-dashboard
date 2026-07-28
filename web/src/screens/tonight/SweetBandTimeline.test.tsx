import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SweetBandTimeline } from './SweetBandTimeline'
import { minutesBetween } from './timeline'
import { ConditionsSchema, PlanTargetsSchema } from '../../api/schemas'
import { recordedConditions, recordedPlan } from '../../test/fixtures'

const conditions = ConditionsSchema.parse(recordedConditions())
const plan = PlanTargetsSchema.parse(recordedPlan())

describe('SweetBandTimeline', () => {
  it('renders one lane per ranked target', () => {
    render(<SweetBandTimeline conditions={conditions} targets={plan.targets} />)
    for (const target of plan.targets) {
      expect(screen.getByText(target.id)).toBeInTheDocument()
    }
  })

  it('labels each bar with the span it actually draws', () => {
    render(<SweetBandTimeline conditions={conditions} targets={plan.targets} />)
    const target = plan.targets[0]
    const drawn = minutesBetween(target.best_window_utc)
    // Guard the distinction rather than assume it: the label must track the
    // rendered span, and must NOT silently become sweet_band_min again.
    expect(drawn).not.toBe(Math.round(target.sweet_band_min))
    expect(screen.getByText(`${drawn} min`)).toBeInTheDocument()
    expect(
      screen.queryByText(`${Math.round(target.sweet_band_min)} min`),
    ).not.toBeInTheDocument()
  })

  it('omits the above-floor rail and its legend entry', () => {
    const { container } = render(
      <SweetBandTimeline conditions={conditions} targets={plan.targets} />,
    )
    expect(container.querySelectorAll('[data-rail]')).toHaveLength(0)
    expect(screen.queryByText(/above floor/i)).not.toBeInTheDocument()
  })

  it('positions every sweet band within the axis', () => {
    const { container } = render(
      <SweetBandTimeline conditions={conditions} targets={plan.targets} />,
    )
    for (const band of container.querySelectorAll<HTMLElement>('[data-band]')) {
      expect(parseFloat(band.style.left)).toBeGreaterThanOrEqual(0)
      expect(parseFloat(band.style.left) + parseFloat(band.style.width)).toBeLessThanOrEqual(100.01)
    }
  })
})
