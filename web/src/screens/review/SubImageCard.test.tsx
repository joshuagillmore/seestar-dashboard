import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SubImageCard } from './SubImageCard'
import { noStarsSub } from './testReasons'

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
