import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Tier2Schema, type QaSubVerdict } from '../../api/schemas'
import { SubTable } from './SubTable'
import { makeSub, noStarsSub, serverReason } from './testReasons'

const real = () =>
  Tier2Schema.parse(
    JSON.parse(
      readFileSync(resolve(__dirname, '../../../../fixtures/qa_tier2.subs.json'), 'utf-8'),
    ),
  ).summary

/** The five metric cells of one row, in column order: FWHM ECC SNR STARS SCATTER. */
const metricCells = (sub: QaSubVerdict) => {
  const row = screen.getByTitle(sub.name).parentElement!
  return [...row.children].slice(1, 6) as HTMLElement[]
}

describe('SubTable — blamed cells', () => {
  it('tones each blamed cell by its own reason, not by the sub’s verdict', () => {
    // Real sub 17: REJECT for FWHM, MARGINAL for eccentricity.
    const sub17 = real().subs.find(
      (s) => s.verdict === 'REJECT' && s.reasons.some((r) => r.startsWith('MARGINAL:')),
    )!
    render(<SubTable subs={[sub17]} />)

    const [fwhm, ecc] = metricCells(sub17)
    expect(fwhm!.className).toMatch(/reject/)
    expect(ecc!.className).toMatch(/marginal/)
    expect(ecc!.className).not.toMatch(/reject/)
  })

  it('tones a star-count cell from the server’s `star_count` reason', () => {
    const sub = makeSub('cloudy', 'REJECT', [serverReason.starReject(12, 16, 32)], {
      star_count: 12,
      fwhm: 2.6,
      eccentricity: 0.4,
      snr: 40,
      scattered_light: 0.003,
    })
    render(<SubTable subs={[sub]} />)

    const stars = metricCells(sub)[3]!
    expect(stars).toHaveTextContent('12')
    expect(stars.className).toMatch(/reject/)
  })
})

describe('SubTable — an unanalysable sub', () => {
  it('shows a dash, not a measured-looking 0, under STARS', () => {
    // The server sends star_count 0 on the error path; the sub was never
    // scored, so there is no star count to show.
    const sub = noStarsSub('dark')
    render(<SubTable subs={[sub]} />)

    const cells = metricCells(sub)
    for (const cell of cells) expect(cell).toHaveTextContent('—')
    for (const cell of cells) expect(cell.className).not.toMatch(/reject|marginal/)
    expect(within(screen.getByTitle(sub.name).parentElement!).getByText('NOT ANALYSED')).toBeInTheDocument()
  })
})

describe('SubTable — when there are no rows', () => {
  it('says the filters hid them, when the report itself has subs', () => {
    render(<SubTable subs={[]} totalUnfiltered={25} />)

    expect(screen.getByText(/no subs match these filters/)).toBeInTheDocument()
    expect(screen.queryByText(/no subs in this report/)).not.toBeInTheDocument()
  })

  it('says the report is empty only when it is', () => {
    render(<SubTable subs={[]} totalUnfiltered={0} />)

    expect(screen.getByText('no subs in this report')).toBeInTheDocument()
  })
})

describe('SubTable — a sub with no reasons', () => {
  // The server always sends at least one line (PASS subs get "PASS: all
  // metrics within session norms"), but an empty list must not be read as
  // a clean bill of health for a sub the server did not pass.
  it('says "clears every gate" only for a PASS', () => {
    render(
      <SubTable
        subs={[
          makeSub('p', 'PASS', [], { eccentricity: 0.4 }),
          makeSub('r', 'REJECT', [], { eccentricity: 0.4 }),
          makeSub('m', 'MARGINAL', [], { eccentricity: 0.4 }),
        ]}
      />,
    )

    expect(screen.getAllByText(/clears every gate/i)).toHaveLength(1)
    const reject = screen.getByTitle('r').parentElement!
    expect(within(reject).queryByText(/clears every gate/i)).not.toBeInTheDocument()
    expect(within(reject).getByText(/no reason given/i)).toBeInTheDocument()
  })
})
