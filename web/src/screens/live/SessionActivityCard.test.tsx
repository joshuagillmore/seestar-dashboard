import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SessionActivityCard } from './SessionActivityCard'
import { SessionActivitySchema } from '../../api/schemas'
import { sessionActivity } from '../../test/fixtures'

const activity = SessionActivitySchema.parse(sessionActivity())

describe('SessionActivityCard', () => {
  it('never labels the column "Claude" — it is an activity feed, not the agent\'s own voice', () => {
    render(<SessionActivityCard activity={activity} sessionRunning={true} />)
    expect(screen.getByText('Session activity')).toBeInTheDocument()
    expect(screen.queryByText(/claude/i)).not.toBeInTheDocument()
  })

  it('renders each record\'s tool and origin, never a synthesised sentence', () => {
    render(<SessionActivityCard activity={activity} sessionRunning={true} />)
    const records = screen.getAllByTestId('session-activity-record')
    expect(records).toHaveLength(3)
    expect(records[0]).toHaveTextContent('goto_target')
    // The design's own chat-bubble prose ("Dropped frames are up to 23,
    // but eccentricity is flat...") must never appear — there is no field
    // in the real payload to source it from.
    expect(screen.queryByText(/eccentricity/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/dropped frames are up to/i)).not.toBeInTheDocument()
  })

  it('gives every record a visible, distinct origin tag — agent, ambiguous, and unknown never collapse together', () => {
    render(<SessionActivityCard activity={activity} sessionRunning={true} />)
    const origins = screen.getAllByTestId('session-activity-origin')
    expect(origins.map((el) => el.getAttribute('data-origin'))).toEqual(['agent', 'ambiguous', 'unknown'])
    // Distinct visual treatment, not just a distinct attribute — three
    // different classes, so a reviewer can't collapse them to one style.
    const classNames = new Set(origins.map((el) => el.className))
    expect(classNames.size).toBe(3)
  })

  it('never presents an "ambiguous" record as the agent\'s own — the label says ambiguous, not agent', () => {
    render(<SessionActivityCard activity={activity} sessionRunning={true} />)
    const origins = screen.getAllByTestId('session-activity-origin')
    expect(origins[1]).toHaveTextContent(/ambiguous/i)
    expect(origins[1]).not.toHaveTextContent(/^agent$/i)
  })

  it('renders an unknown (fully-null) record without crashing, showing an honest placeholder rather than "null"', () => {
    render(<SessionActivityCard activity={activity} sessionRunning={true} />)
    const records = screen.getAllByTestId('session-activity-record')
    expect(records[2]).toHaveTextContent('(unparsed record)')
    expect(records[2]).not.toHaveTextContent(/^null/)
  })

  it('shows a truncation notice when the server reports one', () => {
    render(<SessionActivityCard activity={activity} sessionRunning={true} />)
    expect(screen.getByTestId('session-activity-truncated')).toBeInTheDocument()
  })

  it('omits the truncation notice when the server does not report one', () => {
    render(<SessionActivityCard activity={{ ...activity, truncated: false }} sessionRunning={true} />)
    expect(screen.queryByTestId('session-activity-truncated')).not.toBeInTheDocument()
  })

  it('renders an honest "not available yet" state when the route has not been fetched (null), not a blank hole', () => {
    render(<SessionActivityCard activity={null} sessionRunning={true} />)
    expect(screen.getByTestId('session-activity-unavailable')).toBeInTheDocument()
    expect(screen.queryByTestId('session-activity-list')).not.toBeInTheDocument()
  })

  it('renders the not-configured state distinctly from the not-available and empty states', () => {
    render(
      <SessionActivityCard
        activity={{ ok: true, records: [], truncated: false, source_configured: false }}
        sessionRunning={true}
      />,
    )
    expect(screen.getByTestId('session-activity-not-configured')).toBeInTheDocument()
    expect(screen.queryByTestId('session-activity-unavailable')).not.toBeInTheDocument()
  })

  it('renders an honest empty state when configured but nothing has been logged yet — distinct from unavailable/not-configured, and not an error', () => {
    render(
      <SessionActivityCard
        activity={{ ok: true, records: [], truncated: false, source_configured: true }}
        sessionRunning={true}
      />,
    )
    expect(screen.getByTestId('session-activity-empty')).toBeInTheDocument()
    expect(screen.getByText(/No recorded activity yet/i)).toBeInTheDocument()
    expect(screen.queryByTestId('session-activity-not-configured')).not.toBeInTheDocument()
    expect(screen.queryByTestId('session-activity-unavailable')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('renders newest-first as the server sends it, without re-sorting', () => {
    // The route already returns newest-first (routes.py's session_activity
    // docstring) — this asserts the card renders records in the order
    // given, not that it re-sorts by its own idea of "newest".
    render(<SessionActivityCard activity={activity} sessionRunning={true} />)
    const records = screen.getAllByTestId('session-activity-record')
    expect(records[0]).toHaveTextContent('goto_target')
    expect(records[1]).toHaveTextContent('alpaca.put.action')
  })

  describe('sessionRunning framing', () => {
    it('shows no "not running" note while a session is actually active', () => {
      render(<SessionActivityCard activity={activity} sessionRunning={true} />)
      expect(screen.queryByTestId('session-activity-not-running')).not.toBeInTheDocument()
    })

    it('shows a visible note that nothing is running when idle/bridge-down — the feed itself never implies otherwise', () => {
      render(<SessionActivityCard activity={activity} sessionRunning={false} />)
      expect(screen.getByTestId('session-activity-not-running')).toBeInTheDocument()
      expect(screen.getByText(/no session is running right now/i)).toBeInTheDocument()
      // The note supplements the feed, it doesn't replace it.
      expect(screen.getByTestId('session-activity-list')).toBeInTheDocument()
    })

    it('shows the not-running note alongside the empty/unavailable states too, not only the populated list', () => {
      render(<SessionActivityCard activity={null} sessionRunning={false} />)
      expect(screen.getByTestId('session-activity-not-running')).toBeInTheDocument()
      expect(screen.getByTestId('session-activity-unavailable')).toBeInTheDocument()
    })
  })

  describe('wide', () => {
    it('is off by default — the card keeps its fixed sidebar width', () => {
      render(<SessionActivityCard activity={activity} sessionRunning={true} />)
      const card = screen.getByText('Session activity').closest('section')
      expect(card?.className).not.toMatch(/wide/i)
    })

    it('adds its own wide class when requested, for the idle-layout wide arrangement', () => {
      render(<SessionActivityCard activity={activity} sessionRunning={true} wide />)
      const card = screen.getByText('Session activity').closest('section')
      expect(card?.className).toMatch(/wide/i)
    })
  })
})
