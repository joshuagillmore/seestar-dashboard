import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Tier2Schema, type QaSubVerdict } from '../../api/schemas'
import { MetricChart } from './MetricChart'
import { thresholdLinesFor } from './qa'

const report = Tier2Schema.parse(
  JSON.parse(
    readFileSync(resolve(__dirname, '../../../../fixtures/qa_tier2.subs.json'), 'utf-8'),
  ),
)

/** Percentage out of an inline `height`/`bottom` style, e.g. "42.5%" → 42.5. */
const pct = (el: Element | null, prop: 'height' | 'bottom'): number => {
  const raw = (el as HTMLElement).style[prop]
  return Number.parseFloat(raw)
}

const bars = (container: HTMLElement) =>
  [...container.querySelectorAll('div')].filter((d) => d.style.height.endsWith('%'))

const lines = (container: HTMLElement) =>
  [...container.querySelectorAll('div')].filter((d) => d.style.bottom.endsWith('%'))

/**
 * The chart's geometry.
 *
 * Bars and cutoff lines share one domain or the picture lies, and the failure
 * is silent: a line positioned off the top of the plot just isn't visible,
 * and the chart looks fine. The screen-level test only asserts that a line's
 * LABEL renders, which says nothing about where it was put — so the domain
 * arithmetic is pinned here instead.
 */
describe('MetricChart geometry', () => {
  const subs = report.summary.subs
  const eccLines = thresholdLinesFor('eccentricity', report.summary.thresholds)

  it('keeps a threshold line on the plot even when it exceeds every bar', () => {
    // The ordinary case on a clean session, and the reason the domain is not
    // just max(bars): the real M 81 recording tops out well below its reject
    // cutoff. Scaling to the bars alone would push that line past 100% —
    // invisible, exactly when its absence is the good news worth showing.
    const { container } = render(
      <MetricChart
        eyebrow="ecc"
        subs={subs}
        metric="eccentricity"
        totalSubs={subs.length}
        thresholds={eccLines}
      />,
    )

    const positions = lines(container).map((l) => pct(l, 'bottom'))

    expect(positions).toHaveLength(eccLines.length)
    for (const p of positions) {
      expect(p).toBeGreaterThan(0)
      expect(p).toBeLessThanOrEqual(100)
    }
  })

  it('puts the reject line above the marginal line, and both above the bars', () => {
    const { container } = render(
      <MetricChart
        eyebrow="ecc"
        subs={subs}
        metric="eccentricity"
        totalSubs={subs.length}
        thresholds={eccLines}
      />,
    )

    const [marginal, reject] = lines(container).map((l) => pct(l, 'bottom'))
    const tallestBar = Math.max(...bars(container).map((b) => pct(b, 'height')))

    expect(reject!).toBeGreaterThan(marginal!)
    // True of this recording specifically — nothing came near the rotation
    // cutoff — and the assertion that would have failed under a max(bars)
    // domain, where the tallest bar is pinned at 100%.
    expect(tallestBar).toBeLessThan(reject!)
  })

  it('scales bars to the same domain as the lines', () => {
    // Same subs, once with thresholds and once without. Adding a cutoff above
    // the data must SHRINK the bars, because the domain grew to fit it. If
    // bars were scaled independently they would be unchanged, and a bar
    // crossing a line would mean nothing.
    const withLines = render(
      <MetricChart
        eyebrow="ecc"
        subs={subs}
        metric="eccentricity"
        totalSubs={subs.length}
        thresholds={eccLines}
      />,
    )
    const tallestWith = Math.max(...bars(withLines.container).map((b) => pct(b, 'height')))
    withLines.unmount()

    const without = render(
      <MetricChart eyebrow="ecc" subs={subs} metric="eccentricity" totalSubs={subs.length} />,
    )
    const tallestWithout = Math.max(...bars(without.container).map((b) => pct(b, 'height')))

    expect(tallestWith).toBeLessThan(tallestWithout)
  })

  it('draws no lines when the report has no thresholds', () => {
    const { container } = render(
      <MetricChart eyebrow="ecc" subs={subs} metric="eccentricity" totalSubs={subs.length} />,
    )

    expect(lines(container)).toHaveLength(0)
    expect(bars(container).length).toBeGreaterThan(0)
  })

  it('renders one bar per sub rather than padding to the bucket count', () => {
    // The spec's "don't smooth a sparse target into looking dense" rule, at
    // the render layer rather than in bucketSubs alone.
    const eight = subs.slice(0, 8)
    const { container } = render(
      <MetricChart eyebrow="ecc" subs={eight} metric="eccentricity" totalSubs={8} buckets={60} />,
    )

    expect(bars(container)).toHaveLength(8)
  })

  it('leaves a gap, not a floor-height bar, where nothing was measurable', () => {
    // A sub that was never measured must not look like one that measured
    // zero. The gap element carries no height style, so it is not in bars().
    const unmeasured: QaSubVerdict[] = [
      {
        ...subs[0]!,
        name: 'broken',
        metrics: { ...subs[0]!.metrics, eccentricity: null, error: 'no 2-D image HDU' },
      },
    ]
    const { container } = render(
      <MetricChart eyebrow="ecc" subs={unmeasured} metric="eccentricity" totalSubs={1} />,
    )

    expect(bars(container)).toHaveLength(0)
    expect(container.querySelector('[title*="not analysed"]')).not.toBeNull()
  })

  it('says so when there is nothing to plot', () => {
    render(<MetricChart eyebrow="ecc" subs={[]} metric="eccentricity" totalSubs={0} />)

    expect(screen.getByText('no subs to plot')).toBeInTheDocument()
  })
})
