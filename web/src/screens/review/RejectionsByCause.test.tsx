import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Tier2Schema } from '../../api/schemas'
import { RejectionsByCause } from './RejectionsByCause'
import { makeSub, noStarsSub, serverReason } from './testReasons'

const real = () =>
  Tier2Schema.parse(
    JSON.parse(
      readFileSync(resolve(__dirname, '../../../../fixtures/qa_tier2.subs.json'), 'utf-8'),
    ),
  ).summary

describe('RejectionsByCause', () => {
  it('shows a cloudy night’s star-count rejects rather than "nothing rejected"', () => {
    // The whole-night cloud case: every reject is a star-count reject, in the
    // server's own words. The panel used to read `star count`/`stars` and so
    // told the user nothing had been rejected at all.
    const summary = {
      ...real(),
      subs: [
        makeSub('a', 'REJECT', [serverReason.starReject(11, 16, 32)]),
        makeSub('b', 'REJECT', [serverReason.starReject(9, 16, 32)]),
        makeSub('c', 'PASS', [serverReason.pass]),
      ],
    }
    render(<RejectionsByCause summary={summary} />)

    expect(screen.queryByText(/nothing rejected/)).not.toBeInTheDocument()
    expect(screen.getByText('star count')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('does not count an unanalysable sub as a star-count reject', () => {
    const summary = { ...real(), subs: [noStarsSub('dark')] }
    render(<RejectionsByCause summary={summary} />)

    expect(screen.queryByText('star count')).not.toBeInTheDocument()
    expect(screen.getByText('not analysed')).toBeInTheDocument()
  })

  it('says nothing was rejected only when no sub was', () => {
    const summary = { ...real(), subs: [makeSub('a', 'PASS', [serverReason.pass])] }
    render(<RejectionsByCause summary={summary} />)

    expect(screen.getByText('nothing rejected this session')).toBeInTheDocument()
  })
})
