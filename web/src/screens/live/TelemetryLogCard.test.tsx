import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TelemetryLogCard } from './TelemetryLogCard'
import type { TelemetryEntry } from './telemetryLog'
import type { Tier1 } from '../../api/schemas'

const snapshot = (over: Partial<Tier1> = {}): Tier1 => ({
  ok: true,
  stacked_frame: 400,
  dropped_frame: 20,
  solve_ok: true,
  focus_position: 1640,
  ...over,
})

describe('TelemetryLogCard', () => {
  it('renders newest first — the most recently polled entry is the first line in the DOM', () => {
    const log: TelemetryEntry[] = [
      { atMs: 0, tier1: snapshot({ stacked_frame: 400 }) },
      { atMs: 60_000, tier1: snapshot({ stacked_frame: 406 }) },
      { atMs: 120_000, tier1: snapshot({ stacked_frame: 412 }) },
    ]
    render(<TelemetryLogCard log={log} />)
    const lines = screen.getAllByTestId('telemetry-log-line')
    expect(lines).toHaveLength(3)
    // The newest entry (412, polled last) renders FIRST.
    expect(lines[0]).toHaveTextContent('stacked 412')
    expect(lines[1]).toHaveTextContent('stacked 406')
    expect(lines[2]).toHaveTextContent('stacked 400')
    // And its elapsed bracket is the largest, not the smallest.
    expect(lines[0]).toHaveTextContent('[02:00]')
    expect(lines[2]).toHaveTextContent('[00:00]')
  })

  it('diffs each line against its chronologically previous entry, not the previous rendered row', () => {
    // Both would be "the row above" in a naively-reversed render, so this
    // catches a diff computed against the wrong neighbour.
    const log: TelemetryEntry[] = [
      { atMs: 0, tier1: snapshot({ stacked_frame: 400 }) },
      { atMs: 60_000, tier1: snapshot({ stacked_frame: 406 }) },
    ]
    render(<TelemetryLogCard log={log} />)
    const lines = screen.getAllByTestId('telemetry-log-line')
    expect(lines[0]).toHaveTextContent('stacked 406 (+6)')
  })

  it('never shows a per-sub quality verdict — Tier-1 is health polling, Tier-2 scores at wind-down', () => {
    render(<TelemetryLogCard log={[{ atMs: 0, tier1: snapshot() }]} />)
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
