import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { LastStack } from '../../api/schemas'
import { LastStackCard } from './LastStackCard'
import { formatStackDate, lastStackReasonLabel } from './lastStack'

const found: LastStack = {
  ok: true,
  target: 'M27',
  captured_at: '2026-07-12T21:44:10Z',
  frame_count: 178,
  url: '/api/last_stack/image',
  reason: null,
}

// The real, committed route always sends this literal url — even on the
// absent branch (`_last_stack_absent` hardcodes it) — and `no_stack` is the
// real wire token for "nothing completed yet for this target", not a
// hand-written sentence. See LastStackSchema's own doc comment.
const noneYet: LastStack = {
  ok: true,
  target: null,
  captured_at: null,
  frame_count: null,
  url: '/api/last_stack/image',
  reason: 'no_stack',
}

describe('LastStackCard', () => {
  it('renders the image with its captured date and frame count', () => {
    render(<LastStackCard lastStack={found} />)
    const caption = screen.getByTestId('last-stack-caption')
    // Computed via the same pure formatter, not a hardcoded "12 Jul" — see
    // lastStack.test.ts for why an exact literal would depend on the
    // runner's own timezone.
    expect(caption).toHaveTextContent(formatStackDate(found.captured_at))
    expect(caption).toHaveTextContent('178 frames')
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      expect.stringContaining('/api/last_stack/image'),
    )
  })

  it('never labels the panel "live" — the one rule it exists under', () => {
    render(<LastStackCard lastStack={found} />)
    expect(screen.queryByText(/\blive\b/i)).not.toBeInTheDocument()
    expect(screen.getByRole('img')).not.toHaveAccessibleName(/live/i)
  })

  it('is headed "Last completed stack", not "Live stack"', () => {
    render(<LastStackCard lastStack={found} />)
    expect(screen.getByText('Last completed stack')).toBeInTheDocument()
  })

  it('renders an honest empty state — not an error — when this target has never had a stack completed', () => {
    render(<LastStackCard lastStack={noneYet} />)
    expect(screen.getByTestId('last-stack-empty')).toBeInTheDocument()
    expect(screen.getByText('No completed stack yet for this target.')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('keys the empty state off target, not url — the real route sends the same literal url on both branches', () => {
    // If this card ever regresses to checking `url` instead of `target`, it
    // would try to render an <img> here, since `noneYet.url` is truthy too.
    render(<LastStackCard lastStack={noneYet} />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('never renders a raw reason code — "no_stack" must not appear as literal user-facing text', () => {
    render(<LastStackCard lastStack={noneYet} />)
    expect(screen.queryByText('no_stack')).not.toBeInTheDocument()
  })

  it.each(['idle', 'bridge_down', 'not_configured', 'share_unreachable'] as const)(
    'translates the "%s" wire token into its friendly label, not the raw code',
    (reason) => {
      render(<LastStackCard lastStack={{ ...noneYet, reason }} />)
      expect(screen.getByTestId('last-stack-empty')).toHaveTextContent(lastStackReasonLabel(reason))
      expect(screen.queryByText(reason)).not.toBeInTheDocument()
    },
  )

  it('renders a generic not-available placeholder, distinct wording aside, when nothing has been fetched at all', () => {
    render(<LastStackCard lastStack={null} />)
    expect(screen.getByTestId('last-stack-empty')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
