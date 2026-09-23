import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TargetHeader } from './TargetHeader'
import { formatWhen } from './timestamps'

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

  describe('session start', () => {
    afterEach(() => vi.useRealTimers())

    it('shows when the run started and how long it has been going, from run_state\'s own start', () => {
      // run.session_start_utc is fetched every poll (handback item 20); this
      // header used to say no source for it existed.
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date('2026-08-02T22:40:00Z'))
      const start = '2026-08-02T21:12:44+00:00'
      render(<TargetHeader targetName="NGC7380" stage="Stack" sessionStartUtc={start} />)

      const started = screen.getByTestId('session-started')
      expect(started).toHaveTextContent(`started ${formatWhen(start)}`)
      expect(started).toHaveTextContent('elapsed 1h 27m')
    })

    it('shows no start at all when there is no real one — never the time this tab opened', () => {
      render(<TargetHeader targetName="NGC7380" stage="Stack" sessionStartUtc={null} />)
      expect(screen.queryByTestId('session-started')).not.toBeInTheDocument()
    })
  })

  it('never renders any of the forbidden control buttons', () => {
    render(<TargetHeader targetName="NGC7380" stage="Stack" lpFilter={true} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
