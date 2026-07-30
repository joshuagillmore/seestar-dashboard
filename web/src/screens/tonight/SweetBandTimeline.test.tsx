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

  it('names the zone its clock times are actually in, once, for the whole card', () => {
    // Timezone-independent shape check, same reasoning as PlanCard's — the
    // bracket labels, lane windows and axis ticks below all share this one
    // zone note rather than each repeating it (none of them has the room).
    render(<SweetBandTimeline conditions={conditions} targets={plan.targets} />)
    expect(
      screen.getByText(/^sweet band · times in UTC([+-]\d{1,2}(:\d{2})?)?$/),
    ).toBeInTheDocument()
  })

  it('omits the above-floor rail and its legend entry', () => {
    const { container } = render(
      <SweetBandTimeline conditions={conditions} targets={plan.targets} />,
    )
    // `[data-rail]` matched nothing before this fix either — no element in the
    // component ever set it, so that guard passed vacuously no matter what
    // rendered. Assert on what the chart actually contains instead: the
    // legend text, and exactly one bar per ranked target.
    expect(container.textContent).not.toMatch(/above floor/i)
    expect(container.querySelectorAll('[data-band]')).toHaveLength(plan.targets.length)
  })

  it('draws the axis and every sweet band from the real dark-window scale, not a fixed 19:00–05:00 window', () => {
    const { container } = render(
      <SweetBandTimeline conditions={conditions} targets={plan.targets} />,
    )
    // Pinned against the recorded fixture (dark 19:43:20–03:58:20 UTC):
    // buildScale pads an hour each side and rounds outward to the hour, giving
    // an 18:00Z–05:00Z axis (12 hourly ticks) and a first band starting at
    // ~15.67% of it, 21.26% wide. These are exact enough that reverting
    // buildScale to a hardcoded window, or deleting the axis/strip, changes
    // them — unlike a bare [0,100] clamp check, which holds for any input by
    // construction. Tick count (not label text) is asserted because the
    // labels are local wall-clock and would vary with the test runner's zone;
    // the count is a pure function of the UTC scale either way.
    expect(container.querySelectorAll('[data-tick]')).toHaveLength(12)

    const bands = container.querySelectorAll<HTMLElement>('[data-band]')
    expect(bands).toHaveLength(plan.targets.length)
    for (const band of bands) {
      const left = parseFloat(band.style.left)
      const width = parseFloat(band.style.width)
      expect(left).toBeGreaterThanOrEqual(0)
      expect(left + width).toBeLessThanOrEqual(100.01)
    }
    expect(parseFloat(bands[0].style.left)).toBeCloseTo(15.67, 1)
    expect(parseFloat(bands[0].style.width)).toBeCloseTo(21.26, 1)
  })

  it('renders all 12 lanes inside the scroll container, not just the visible ~3', () => {
    // Pinned against the real fixture count (limit=12), not merely
    // plan.targets.length, so a regression that silently clips to some other
    // bound still fails even if it coincidentally matches a looser check. A
    // scroll container that drops rows to fit the visible area would be worse
    // than no scroll at all — nothing on screen would reveal it.
    expect(plan.targets).toHaveLength(12)
    render(<SweetBandTimeline conditions={conditions} targets={plan.targets} />)
    const scroller = screen.getByTestId('lane-scroll')
    expect(scroller.querySelectorAll('[data-band]')).toHaveLength(12)
    for (const target of plan.targets) {
      expect(scroller).toContainElement(screen.getByText(target.id))
    }
  })
})
