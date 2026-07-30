import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TelemetryLogCard } from './TelemetryLogCard'
import type { TelemetryEntry } from './telemetryLog'
import type { Tier1 } from '../../api/schemas'

const snapshot = (ts: string, statusLine: string, flags: string[] = []): Tier1 => ({
  ok: true,
  snapshot: {
    ts,
    stacked: 400,
    rejected: 20,
    solve_ok: true,
    solve_rms: 1.5,
    focus_pos: 1640,
    hfd: 2.5,
    tracking: true,
  },
  flags,
  status_line: statusLine,
  trends: { stacked_delta: 6, rejected_delta: 0, focus_delta: 2, hfd_delta: 0 },
})

describe('TelemetryLogCard', () => {
  it('renders newest first — the most recently polled entry is the first line in the DOM', () => {
    const log: TelemetryEntry[] = [
      { tier1: snapshot('2026-07-30T00:00:00Z', 'stacked 400 (+0)') },
      { tier1: snapshot('2026-07-30T00:01:00Z', 'stacked 406 (+6)') },
      { tier1: snapshot('2026-07-30T00:02:00Z', 'stacked 412 (+6)') },
    ]
    render(<TelemetryLogCard log={log} />)
    const lines = screen.getAllByTestId('telemetry-log-line')
    expect(lines).toHaveLength(3)
    // The newest entry (polled last) renders FIRST.
    expect(lines[0]).toHaveTextContent('stacked 412 (+6)')
    expect(lines[1]).toHaveTextContent('stacked 406 (+6)')
    expect(lines[2]).toHaveTextContent('stacked 400 (+0)')
    // And its elapsed bracket is the largest, not the smallest.
    expect(lines[0]).toHaveTextContent('[02:00]')
    expect(lines[2]).toHaveTextContent('[00:00]')
  })

  it('renders qa_tier1\'s own status_line verbatim, not a recomposed one', () => {
    const line = 'stacked 211 (+1) | rejected 0 | solve OK | focus Δ=+3 | hfd 2.40'
    render(<TelemetryLogCard log={[{ tier1: snapshot('2026-07-30T00:00:00Z', line) }]} />)
    expect(screen.getByTestId('telemetry-log-line')).toHaveTextContent(line)
  })

  it('renders a non-empty flags array as visible text, verbatim, never inventing one when flags is empty', () => {
    const withFlag: TelemetryEntry = { tier1: snapshot('2026-07-30T00:00:00Z', 'stacked 400', ['dew risk rising']) }
    const { rerender } = render(<TelemetryLogCard log={[withFlag]} />)
    expect(screen.getByText(/dew risk rising/)).toBeInTheDocument()

    rerender(<TelemetryLogCard log={[{ tier1: snapshot('2026-07-30T00:00:00Z', 'stacked 400') }]} />)
    expect(screen.queryByText(/dew risk rising/)).not.toBeInTheDocument()
  })

  it('never shows a per-sub quality verdict — Tier-1 is health polling, Tier-2 scores at wind-down', () => {
    render(<TelemetryLogCard log={[{ tier1: snapshot('2026-07-30T00:00:00Z', 'stacked 400') }]} />)
    expect(screen.getByText(/Quality verdict pending/i)).toBeInTheDocument()
    expect(screen.getByText(/Tier-2 scores the FITS at wind-down/i)).toBeInTheDocument()
    expect(screen.queryByText(/\bREJECT\b/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\bPASS\b/)).not.toBeInTheDocument()
  })

  it('renders an honest empty state before any poll has landed', () => {
    render(<TelemetryLogCard log={[]} />)
    expect(screen.getByText(/No health telemetry polled yet/i)).toBeInTheDocument()
  })
})
