import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SubImageCard } from './SubImageCard'
import { makeSub, noStarsSub } from './testReasons'

const card = (sub: Parameters<typeof SubImageCard>[0]['sub']) =>
  render(<SubImageCard targetId="M81" sub={sub} onClose={vi.fn()} />)

/** The value cell beside a metric's label in the card's <dl>. */
const valueOf = (label: string) => screen.getByText(label).nextElementSibling as HTMLElement

describe('SubImageCard — an unanalysable sub', () => {
  it('shows a dash for star count, not the 0 the server sends on the error path', () => {
    card(noStarsSub('dark'))

    expect(valueOf('star count')).toHaveTextContent('—')
    expect(screen.getByText('NOT ANALYSED')).toBeInTheDocument()
    expect(screen.getByText('no stars detected')).toBeInTheDocument()
  })
})

describe('SubImageCard — a sub with no reasons', () => {
  it('does not say a REJECT clears every gate', () => {
    card(makeSub('r', 'REJECT', [], { eccentricity: 0.4 }))

    expect(screen.queryByText(/clears every gate/i)).not.toBeInTheDocument()
    expect(screen.getByText(/no reason given/i)).toBeInTheDocument()
  })

  it('does say it for a PASS', () => {
    card(makeSub('p', 'PASS', [], { eccentricity: 0.4 }))

    expect(screen.getByText(/clears every gate/i)).toBeInTheDocument()
  })
})
