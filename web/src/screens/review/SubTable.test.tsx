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
