import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TargetHeader } from './TargetHeader'

describe('TargetHeader', () => {
  it('renders the target name and stage', () => {
    render(<TargetHeader targetName="NGC7380" stage="Stack" />)
    expect(screen.getByText('NGC7380')).toBeInTheDocument()
    expect(screen.getByText(/stage Stack/)).toBeInTheDocument()
  })

  it('renders "Target unknown" rather than a blank heading when no name has resolved', () => {
    render(<TargetHeader targetName={null} stage={null} />)
    expect(screen.getByText('Target unknown')).toBeInTheDocument()
  })

  it('renders an "LP filter" chip when the filter is confirmed on', () => {
    render(<TargetHeader targetName="NGC7380" stage="Stack" lpFilter={true} />)
    const chip = screen.getByTestId('lp-filter-chip')
    expect(chip).toHaveTextContent('LP filter')
    expect(chip).not.toHaveTextContent('off')
    expect(chip).toHaveAttribute('data-lp-filter', 'true')
  })

  it('renders a distinct "LP filter off" chip — not silence — when the filter is confirmed off', () => {
    render(<TargetHeader targetName="NGC7380" stage="Stack" lpFilter={false} />)
    const chip = screen.getByTestId('lp-filter-chip')
    expect(chip).toHaveTextContent('LP filter off')
    expect(chip).toHaveAttribute('data-lp-filter', 'false')
  })

  it('renders no chip at all when lpFilter is undefined — the field missing must not read as "off"', () => {
    render(<TargetHeader targetName="NGC7380" stage="Stack" />)
    expect(screen.queryByTestId('lp-filter-chip')).not.toBeInTheDocument()
  })

  it('renders no chip at all when lpFilter is explicitly null, same as undefined', () => {
    render(<TargetHeader targetName="NGC7380" stage="Stack" lpFilter={null} />)
    expect(screen.queryByTestId('lp-filter-chip')).not.toBeInTheDocument()
  })

  it('never renders any of the forbidden control buttons', () => {
    render(<TargetHeader targetName="NGC7380" stage="Stack" lpFilter={true} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
