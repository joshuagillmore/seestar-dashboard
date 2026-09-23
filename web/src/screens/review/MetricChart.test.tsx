import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Tier2Schema, type QaSubVerdict } from '../../api/schemas'
import { MetricChart } from './MetricChart'
import { thresholdLinesFor } from './qa'
import { makeSub, serverReason } from './testReasons'

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

/**
 * A real session is hundreds of subs, so bucketing (above 60 on desktop, 40
 * on mobile) is the ORDINARY path, not an edge case. These run there.
 */
describe('MetricChart on a bucketed session', () => {
  // Synthetic cutoffs — deliberately not the policy numbers.
  const SYN = { eccentricity_reject: 0.9, eccentricity_marginal: 0.7 }
  const eccLines = thresholdLinesFor('eccentricity', SYN)

  const session = (): QaSubVerdict[] =>
    Array.from({ length: 120 }, (_, i) => {
      const name = `Light_T_10.0s_LP_${String(i).padStart(4, '0')}`
      if (i === 57) {
        return makeSub(name, 'REJECT', [serverReason.eccReject(0.95, 0.9)], {
          eccentricity: 0.95,
        })
      }
      if (i === 90) {
        // Rejected, but for FWHM — its eccentricity is ordinary.
        return makeSub(name, 'REJECT', [serverReason.fwhmReject(2.8, 2.74, 2.61)], {
          eccentricity: 0.4,
          fwhm: 2.8,
        })
      }
      return makeSub(name, 'PASS', [serverReason.pass], { eccentricity: 0.38 + (i % 5) * 0.01 })
    })

  const draw = () =>
    render(
      <MetricChart
        eyebrow="ecc"
        subs={session()}
        metric="eccentricity"
        totalSubs={120}
        thresholds={eccLines}
      />,
    )

  it('draws a single outlier ABOVE the reject line it crossed', () => {
    const { container } = draw()

    // 120 subs into 60 bars: it really is bucketed.
    expect(bars(container)).toHaveLength(60)
    const rejectLine = lines(container).map((l) => pct(l, 'bottom'))[1]!
    const tallest = Math.max(...bars(container).map((b) => pct(b, 'height')))

    // Averaged with its bucket-mate it would sit below the line.
    expect(tallest).toBeGreaterThan(rejectLine)
  })

  it('paints no bar red that is below the marginal line', () => {
    // Sub 90 was rejected for FWHM. On the eccentricity chart its bar is an
    // ordinary eccentricity and must not be red on the passing side.
    const { container } = draw()
    const marginalLine = lines(container).map((l) => pct(l, 'bottom'))[0]!

    const redBelow = bars(container).filter(
      (b) => /reject/.test(b.className) && pct(b, 'height') < marginalLine,
    )
    expect(redBelow).toEqual([])
  })

  it('names each bar’s verdict and the server’s reason, not just its colour', () => {
    const { container } = draw()

    const red = bars(container).filter((b) => /reject/.test(b.className))
    expect(red).toHaveLength(1)
    const label = red[0]!.getAttribute('aria-label') ?? ''
    expect(label).toContain(serverReason.eccReject(0.95, 0.9))
    expect(red[0]!.getAttribute('title')).toBe(label)

    // A clean bar says so in words too.
    const clean = bars(container).find((b) => !/reject|marginal/.test(b.className))!
    expect(clean.getAttribute('aria-label')).toMatch(/PASS/)
  })
})
