import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SweetBandTimeline } from './SweetBandTimeline'
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

  it('labels each sweet band with its duration in minutes', () => {
    render(<SweetBandTimeline conditions={conditions} targets={plan.targets} />)
    expect(screen.getByText(`${Math.round(plan.targets[0].sweet_band_min)} min`)).toBeInTheDocument()
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
