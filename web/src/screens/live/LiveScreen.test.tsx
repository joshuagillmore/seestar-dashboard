import { StrictMode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LiveScreen } from './LiveScreen'
import { SiteProfileSchema, ViewStateSchema, type Health } from '../../api/schemas'
import { stubMatchMedia } from '../../test/matchMedia'
import {
  lastStackAbsent,
  lastStackFound,
  livePreviewStale,
  livePreviewStacked,
  livePreviewSub,
  recordedFocuserPosition,
  recordedGuardrails,
  recordedObservability,
  recordedSite,
  recordedStatus,
  recordedTier1,
  recordedViewState,
  runStateActive as runStateActiveFixture,
  runStateIdle,
  sessionActivity,
} from '../../test/fixtures'
import { formatStackDate, lastStackReasonLabel } from './lastStack'
import { POLL_INTERVAL_MS } from './useLiveSession'

const site = SiteProfileSchema.parse(recordedSite())
const notReplaying: Health = { ok: true, replay: false }

type Body = unknown

/** A per-URL fetch stub, defaulting every live-session endpoint to a happy
 * "session active" response using the REAL recorded fixtures — override
 * individual URLs per test. `check_night_guardrails` and
 * `get_target_observability` carry query params useLiveSession builds at
 * runtime (a generated timestamp, the discovered target id) that this test
 * cannot predict exactly, so matching is done on the path before `?`, not
 * the full URL. */
function stubApi(overrides: Record<string, Body | (() => Body)> = {}) {
  const bodies: Record<string, Body | (() => Body)> = {
    '/api/get_status': recordedStatus(),
    '/api/get_view_state': recordedViewState(),
    '/api/check_night_guardrails': recordedGuardrails(),
    '/api/qa_tier1': recordedTier1(),
    '/api/get_focuser_position': recordedFocuserPosition(),
    '/api/get_target_observability': recordedObservability(),
    '/api/live_preview': livePreviewStacked(),
    '/api/session_activity': sessionActivity(),
    '/api/last_stack': lastStackFound(),
    ...overrides,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = url.split('?')[0]
      if (!(path in bodies)) {
        return { ok: false, status: 404, json: async () => ({ ok: false, error: `no stub for ${url}` }) }
      }
      const entry = bodies[path]
      const body = typeof entry === 'function' ? (entry as () => Body)() : entry
      return { ok: true, status: 200, json: async () => body }
    }),
  )
}

/** `get_status` succeeds but `get_view_state` fails/times out — the
 * documented idle-scope case (slice-3 spec §4), not a bridge problem.
 * `session_activity` is served with real data by default (overridable) —
 * it reads a local file unrelated to either of the calls above, and the
 * user asked for it to render during idle too. */
function stubIdle(overrides: Record<string, Body | (() => Body)> = {}) {
  const bodies: Record<string, Body | (() => Body)> = {
    '/api/session_activity': sessionActivity(),
    ...overrides,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = url.split('?')[0]
      if (path === '/api/get_status') return { ok: true, status: 200, json: async () => recordedStatus() }
      if (path === '/api/get_view_state') {
        return {
          ok: false,
          status: 502,
          json: async () => ({ ok: false, error: 'get_view_state timed out — scope not observing' }),
        }
      }
      // `undefined` in an override map means "no stub for this path" (used
      // to simulate a route that 404s, e.g. session_activity not deployed
      // yet) — checked explicitly, since `in` alone is true for a key set
      // to `undefined` too.
      if (path in bodies && bodies[path] !== undefined) {
        const entry = bodies[path]
        return { ok: true, status: 200, json: async () => (typeof entry === 'function' ? entry() : entry) }
      }
      return { ok: false, status: 404, json: async () => ({ ok: false, error: `no stub for ${url}` }) }
    }),
  )
}

/** `get_status` itself fails — the connection is gone, not merely idle.
 * `session_activity` still succeeds by default: it's a local file read on
 * the sidecar's own disk, not gated behind the MCP connection the bridge
 * check above is testing. */
function stubBridgeDown(overrides: Record<string, Body | (() => Body)> = {}) {
  const bodies: Record<string, Body | (() => Body)> = {
    '/api/session_activity': sessionActivity(),
    ...overrides,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const path = url.split('?')[0]
      if (path === '/api/get_status') {
        return {
          ok: false,
          status: 502,
          json: async () => ({ ok: false, error: 'bridge unreachable: connection refused' }),
        }
      }
      // See stubIdle's matching comment on why `undefined` is checked
      // explicitly, not just key presence.
      if (path in bodies && bodies[path] !== undefined) {
        const entry = bodies[path]
        return { ok: true, status: 200, json: async () => (typeof entry === 'function' ? entry() : entry) }
      }
      return { ok: false, status: 502, json: async () => ({ ok: false, error: 'unreachable' }) }
    }),
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('LiveScreen', () => {
  it('shows a loading state first', () => {
    stubApi()
    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    expect(screen.getByTestId('live-loading')).toBeInTheDocument()
  })

  it('renders a distinct idle state — not an error banner — when the scope is not observing', async () => {
    stubIdle()
    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() => expect(screen.getByTestId('live-idle')).toBeInTheDocument())
    expect(screen.getByText(/Scope idle/i)).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByTestId('live-bridge-down')).not.toBeInTheDocument()
  })

  it('renders a distinct bridge-down state when the connection check itself fails', async () => {
    stubBridgeDown()
    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() => expect(screen.getByTestId('live-bridge-down')).toBeInTheDocument())
    // Scoped to the title (a <div>) — the body text below it also contains
    // "unreachable" (it's the raw ApiError message), which would collide
    // with an unscoped match.
    expect(screen.getByText('Bridge unreachable', { selector: 'div' })).toBeInTheDocument()
    expect(screen.queryByTestId('live-idle')).not.toBeInTheDocument()
  })

  it('shows the session activity feed alongside the idle state — the user\'s explicit call: it is not gated on the telescope', async () => {
    stubIdle()
    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() => expect(screen.getByTestId('live-idle')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('session-activity-list')).toBeInTheDocument())
    // The framing that keeps a busy-looking historical feed from implying a
    // session is running.
    expect(screen.getByTestId('session-activity-not-running')).toBeInTheDocument()
  })

  it('shows the session activity feed alongside bridge-down too — it reads a local file, not the MCP connection the bridge check exercises', async () => {
    stubBridgeDown()
    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() => expect(screen.getByTestId('live-bridge-down')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('session-activity-list')).toBeInTheDocument())
    // With the bridge down this client cannot know whether a session is
    // running, so the feed must not say "No session is running right now".
    expect(screen.queryByTestId('session-activity-not-running')).not.toBeInTheDocument()
  })

  it('does not contradict get_run_state when it reports an active run with the bridge down', async () => {
    // run_state is a file read on the server, so it can still answer while
    // the scope link is gone.
    stubBridgeDown({ '/api/get_run_state': runStateActiveFixture() })
    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() => expect(screen.getByTestId('live-bridge-down')).toBeInTheDocument())
    const runTarget = (runStateActiveFixture() as { run: { target: string } }).run.target
    expect(screen.getByTestId('live-bridge-down')).toHaveTextContent(/active run/)
    expect(screen.getByTestId('live-bridge-down')).toHaveTextContent(runTarget)
    await waitFor(() => expect(screen.getByTestId('session-activity-list')).toBeInTheDocument())
    expect(screen.queryByTestId('session-activity-not-running')).not.toBeInTheDocument()
  })

  it('does not show the "not running" note during an active session — a session genuinely is running', async () => {
    stubApi()
    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() => expect(screen.getByTestId('session-activity-list')).toBeInTheDocument())
    expect(screen.queryByTestId('session-activity-not-running')).not.toBeInTheDocument()
  })

  it('renders an honest empty activity feed during idle, distinct from an error, when nothing has been logged yet', async () => {
    stubIdle({
      '/api/session_activity': { ok: true, records: [], truncated: false, source_configured: true },
    })
    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() => expect(screen.getByTestId('live-idle')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('session-activity-empty')).toBeInTheDocument())
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByTestId('session-activity-unavailable')).not.toBeInTheDocument()
  })

  it('renders the not-available placeholder during idle, not a blank hole, when session_activity 404s', async () => {
    stubIdle({ '/api/session_activity': undefined })
    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() => expect(screen.getByTestId('live-idle')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('session-activity-unavailable')).toBeInTheDocument())
  })

  it('renders idle and bridge-down with different sidebar dot tones', async () => {
    stubIdle()
    const { unmount } = render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() => expect(screen.getByTestId('live-idle')).toBeInTheDocument())
    const idleTone = screen.getAllByTestId('dot')[1].getAttribute('data-dot')
    unmount()

    stubBridgeDown()
    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() => expect(screen.getByTestId('live-bridge-down')).toBeInTheDocument())
    const bridgeDownTone = screen.getAllByTestId('dot')[1].getAttribute('data-dot')

    expect(idleTone).not.toBe(bridgeDownTone)
    expect(idleTone).toBe('idle')
    expect(bridgeDownTone).toBe('reject')
  })

  it('renders the active session once get_view_state succeeds', async () => {
    stubApi()
    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() => expect(screen.getByTestId('telemetry-grid')).toBeInTheDocument())
    // The grid reads Stack.stacked_frame/dropped_frame from the real,
    // recorded get_view_state fixture (115/0) — proof the real nesting
    // (ok.view_state.result.View.Stack) was actually parsed, not merely
    // that SOME number rendered.
    expect(screen.getByText('115')).toBeInTheDocument()
    // The target header sources its name from get_target_observability
    // once it resolves (the recorded fixture is M27 / Dumbbell Nebula).
    await waitFor(() => expect(screen.getByText('Dumbbell Nebula')).toBeInTheDocument())
  })

  it('reports a get_view_state it cannot parse as exactly that — never as idle, and never as fabricated telemetry', async () => {
    // The shape an earlier ViewStateSchema expected: ok.result.View, one
    // level shallower than the real ok.view_state.result.View. It fails
    // validation, which proves the wrapper is load-bearing.
    //
    // This test used to assert that the failure rendered IDLE. That was the
    // defect, pinned: a schema mismatch is the telescope answering in a shape
    // we do not understand, and the same misreport happened on hardware
    // (AnnotateSchema's doc comment) — "idle" while it stacked 94 frames.
    stubApi({
      '/api/get_view_state': { ok: true, result: { View: { stage: 'Stack' } } },
    })
    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() => expect(screen.getByTestId('live-unrecognised')).toBeInTheDocument())
    expect(screen.getByText(/shape this dashboard doesn.t understand/i)).toBeInTheDocument()
    // The parse detail is shown, so the mismatch can be diagnosed from the screen.
    expect(screen.getByTestId('live-unrecognised-detail')).toHaveTextContent(/unexpected payload from \/api\/get_view_state/)
    expect(screen.queryByTestId('live-idle')).not.toBeInTheDocument()
    expect(screen.queryByTestId('telemetry-grid')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('dot')[1]).not.toHaveAttribute('data-dot', 'idle')
    // Nor does the activity feed claim "no session is running": unknown.
    await waitFor(() => expect(screen.getByTestId('session-activity-list')).toBeInTheDocument())
    expect(screen.queryByTestId('session-activity-not-running')).not.toBeInTheDocument()
    // The sidecar answered, so the bridge is up: no get_status spend.
    expect(fetchedUrls().some((u) => u.includes('get_status'))).toBe(false)
  })

  it('marks a "sub" source preview as a single frame, visibly, not just via a data attribute', async () => {
    stubApi({ '/api/live_preview': livePreviewSub() })
    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() => expect(screen.getByTestId('preview-source-sub')).toBeInTheDocument())
    expect(screen.getByText(/single 10 s sub — not the accumulating stack/i)).toBeInTheDocument()
  })

  it('does not show the single-frame badge for a stacked-source preview', async () => {
    stubApi({ '/api/live_preview': livePreviewStacked() })
    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() => expect(screen.getByTestId('telemetry-grid')).toBeInTheDocument())
    expect(screen.queryByTestId('preview-source-sub')).not.toBeInTheDocument()
  })

  it('makes a stale preview frame visible, with when it is actually from', async () => {
    stubApi({ '/api/live_preview': livePreviewStale() })
    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() => expect(screen.getByTestId('preview-stale')).toBeInTheDocument())
    expect(screen.getByText(/stale — from/i)).toBeInTheDocument()
  })

  it('does not show a stale badge for a fresh preview', async () => {
    stubApi({ '/api/live_preview': livePreviewStacked() })
    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() => expect(screen.getByTestId('telemetry-grid')).toBeInTheDocument())
    expect(screen.queryByTestId('preview-stale')).not.toBeInTheDocument()
  })

  it('keeps the plate-solve overlay off by default, and toggles it on', async () => {
    stubApi()
    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() => expect(screen.getByTestId('telemetry-grid')).toBeInTheDocument())
    expect(screen.queryByTestId('preview-overlay')).not.toBeInTheDocument()
    // But the framing readout — information, not decoration — is visible
    // regardless, per the slice-3 spec's own ruling. Numbers are the real
    // recorded fixture's (pixelx 309.123, pixely 1190.65 against a 540/960 centre) — a live capture, read from Annotate.result.annotations[0].
    expect(screen.getByTestId('framing-readout')).toHaveTextContent(/offset 231 px left — in frame/)

    fireEvent.click(screen.getByRole('button', { name: /show plate-solve overlay/i }))
    expect(screen.getByTestId('preview-overlay')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /hide plate-solve overlay/i }))
    expect(screen.queryByTestId('preview-overlay')).not.toBeInTheDocument()
  })

  it('renders the telemetry log with the current poll\'s status_line', async () => {
    stubApi()
    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() => expect(screen.getByTestId('telemetry-log-body')).toBeInTheDocument())
    await waitFor(() => expect(screen.getAllByTestId('telemetry-log-line').length).toBeGreaterThan(0))
    expect(screen.getByText(/Quality verdict pending/i)).toBeInTheDocument()
    expect(screen.getByText(/stacked 115/)).toBeInTheDocument()
  })

  it('never shows a per-sub PASS/MARGINAL/REJECT verdict during the session', async () => {
    stubApi()
    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() => expect(screen.getByTestId('telemetry-grid')).toBeInTheDocument())
    expect(screen.queryByText(/\bREJECT\b/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\bMARGINAL\b/)).not.toBeInTheDocument()
  })

  it('renders no telescope-control buttons at all — the whole slice-3 §0 point', async () => {
    stubApi()
    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() => expect(screen.getByTestId('telemetry-grid')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /refocus/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /stop stack/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /wind down/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
  })

  it('renders the guardrails card from the real flat shape — action verbatim, not five invented named checks', async () => {
    stubApi()
    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() => expect(screen.getByText('check_night_guardrails')).toBeInTheDocument())
    expect(screen.getByText('continue')).toBeInTheDocument()
  })

  it('renders the third column as session activity, not a "Claude" chat transcript', async () => {
    stubApi()
    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() => expect(screen.getByTestId('session-activity-list')).toBeInTheDocument())
    expect(screen.getByText('Session activity')).toBeInTheDocument()
    expect(screen.queryByText(/claude/i)).not.toBeInTheDocument()
    const records = screen.getAllByTestId('session-activity-record')
    expect(records.length).toBeGreaterThan(0)
    // Origin is visible per record, never flattened into one column-wide tone.
    const origins = screen.getAllByTestId('session-activity-origin').map((el) => el.getAttribute('data-origin'))
    expect(new Set(origins).size).toBeGreaterThan(1)
  })

  it('renders an honest "not available yet" placeholder in the reserved third column when /api/session_activity is not deployed — not a blank hole', async () => {
    // stubApi's override map can't express "no stub at all" for one key
    // (an override still adds the key), so this builds the fetch stub
    // directly, omitting /api/session_activity entirely — exactly the
    // "route not deployed yet" case (a real 404, not a slow/failed call).
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = url.split('?')[0]
        if (path === '/api/session_activity') {
          return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not found' }) }
        }
        const bodies: Record<string, unknown> = {
          '/api/get_status': recordedStatus(),
          '/api/get_view_state': recordedViewState(),
          '/api/check_night_guardrails': recordedGuardrails(),
          '/api/qa_tier1': recordedTier1(),
          '/api/get_focuser_position': recordedFocuserPosition(),
          '/api/get_target_observability': recordedObservability(),
          '/api/live_preview': livePreviewStacked(),
        }
        if (!(path in bodies)) {
          return { ok: false, status: 404, json: async () => ({ ok: false, error: `no stub for ${url}` }) }
        }
        return { ok: true, status: 200, json: async () => bodies[path] }
      }),
    )
    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() => expect(screen.getByTestId('telemetry-grid')).toBeInTheDocument())
    expect(screen.getByTestId('session-activity-unavailable')).toBeInTheDocument()
    expect(screen.getByText('Session activity')).toBeInTheDocument()
  })

  describe('last completed stack panel', () => {
    it('renders beneath the live preview with its date and frame count, wired to the real hook state', async () => {
      stubApi()
      render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
      await waitFor(() => expect(screen.getByTestId('last-stack-caption')).toBeInTheDocument())
      const fixture = lastStackFound() as { captured_at: string; frame_count: number }
      expect(screen.getByTestId('last-stack-caption')).toHaveTextContent(
        formatStackDate(fixture.captured_at),
      )
      expect(screen.getByTestId('last-stack-caption')).toHaveTextContent(`${fixture.frame_count} frames`)
    })

    it('never labels the panel "live" — it must not be mistaken for the current stack', async () => {
      stubApi()
      render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
      await waitFor(() => expect(screen.getByTestId('last-stack-caption')).toBeInTheDocument())
      expect(screen.getByText('Last completed stack')).toBeInTheDocument()
      // Scoped to this card alone — "Live session"/"Live stack"/the sidebar's
      // "live" meta all legitimately appear elsewhere on this screen; the
      // property under test is that THIS panel never carries the word.
      const panel = screen.getByTestId('last-stack-card')
      expect(within(panel).queryByText(/\blive\b/i)).not.toBeInTheDocument()
    })

    it('renders an honest empty state, not an error, when this target has no completed stack yet', async () => {
      stubApi({ '/api/last_stack': lastStackAbsent() })
      render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
      await waitFor(() => expect(screen.getByTestId('last-stack-empty')).toBeInTheDocument())
      // The fixture's real wire token is "no_stack" (see LastStackSchema's
      // own doc comment) — translated to prose, never rendered raw.
      expect(screen.getByText(lastStackReasonLabel('no_stack'))).toBeInTheDocument()
      expect(screen.queryByText('no_stack')).not.toBeInTheDocument()
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('fetches /api/last_stack scoped to the resolved target — the wiring shouldFetchLastStack\'s own unit tests assume exists', async () => {
      const calls: string[] = []
      stubApi()
      const realFetch = globalThis.fetch
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        calls.push(url)
        return realFetch(url)
      }))
      render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
      await waitFor(() => expect(screen.getByTestId('last-stack-caption')).toBeInTheDocument())
      // Read the expected id off the recording rather than hardcoding it. This
      // assertion said 'M27' — the SYNTHETIC preview fixture's target — and
      // that passed only while the client sourced the target from the preview
      // alone. It now comes from get_view_state's own View.target_name, which
      // the real recording gives as NGC7380, and the two fixtures legitimately
      // disagree: the share lags the scope, which is precisely the condition
      // that made the old precedence wrong.
      const resolved = ViewStateSchema.parse(recordedViewState()).view_state?.result?.View
        ?.target_name
      expect(resolved).toBeTruthy()
      expect(calls.some((url) => url.startsWith('/api/last_stack') && url.includes(resolved!))).toBe(
        true,
      )
    })
  })

  it("sources the target header's LP filter chip from get_view_state's own lp_filter field", async () => {
    stubApi()
    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() => expect(screen.getByTestId('lp-filter-chip')).toBeInTheDocument())
    // The real recorded fixture (NGC 7380, firmware 7.75) carries lp_filter: true.
    expect(screen.getByTestId('lp-filter-chip')).toHaveAttribute('data-lp-filter', 'true')
  })

  it("sources the target header's name from get_view_state's target_name when observability hasn't resolved one", async () => {
    // A genuine tool failure — observability legitimately unavailable this
    // poll — not a 404; get()'s isToolFailure() branch turns this into the
    // ApiError useLiveSession's own .catch(() => null) absorbs.
    stubApi({ '/api/get_target_observability': { ok: false, error: 'target not resolved yet' } })
    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() => expect(screen.getByTestId('telemetry-grid')).toBeInTheDocument())
    // recordedViewState()'s View.target_name is "NGC7380" — distinct from
    // live_preview's own target field ("M27"), so this proves the header is
    // reading view.target_name rather than falling all the way back to
    // currentTarget.
    expect(screen.getByText('NGC7380')).toBeInTheDocument()
  })

  describe('mobile breakpoint', () => {
    it('renders MobileLiveView and drops the AppShell chrome once the mobile breakpoint matches', async () => {
      stubMatchMedia(true)
      stubApi()
      render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
      await waitFor(() => expect(screen.getByTestId('mobile-live-tiles')).toBeInTheDocument())
      // The desktop three-column composition (telemetry grid, sweet-band
      // gauge, guardrails card, session activity feed) must not also render
      // — this is a swap, not an addition.
      expect(screen.queryByTestId('telemetry-grid')).not.toBeInTheDocument()
      expect(screen.queryByText('check_night_guardrails')).not.toBeInTheDocument()
      // No TopBar wordmark, and no Sidebar-only content (site profile block,
      // the "Session" eyebrow) — the design's phone frame has zero chrome
      // (see LiveScreen.tsx's own doc comment on why). MobileNav's own
      // "Tonight"/"Live" tabs are the one exception — see the dedicated
      // MobileNav coverage below and MobileNav.test.tsx.
      expect(screen.queryByText('seestar')).not.toBeInTheDocument()
      expect(screen.queryByText('Session')).not.toBeInTheDocument()
      expect(screen.queryByText(/Site profile/)).not.toBeInTheDocument()
    })

    it('keeps the ordinary desktop layout, chrome included, when the mobile breakpoint does not match', async () => {
      stubMatchMedia(false)
      stubApi()
      render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
      await waitFor(() => expect(screen.getByTestId('telemetry-grid')).toBeInTheDocument())
      expect(screen.queryByTestId('mobile-live-tiles')).not.toBeInTheDocument()
      expect(screen.getByText('Session')).toBeInTheDocument()
      expect(screen.getByText('seestar')).toBeInTheDocument()
    })

    it('gives mobile a working nav — MobileNav marks Live active and switching to Tonight actually calls onNavigate', async () => {
      stubMatchMedia(true)
      stubApi()
      const onNavigate = vi.fn()
      render(<LiveScreen view="live" onNavigate={onNavigate} site={site} health={notReplaying} />)
      await waitFor(() => expect(screen.getByTestId('mobile-live-tiles')).toBeInTheDocument())
      expect(screen.getByRole('button', { name: 'Live' })).toHaveAttribute('aria-current', 'page')
      fireEvent.click(screen.getByRole('button', { name: 'Tonight' }))
      expect(onNavigate).toHaveBeenCalledWith('tonight')
    })

    it('renders the idle state full-width, without AppShell chrome, at the mobile breakpoint too — the design has no dedicated mobile idle screen, so this keeps the ordinary idle card rather than inventing one', async () => {
      stubMatchMedia(true)
      stubIdle()
      render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
      await waitFor(() => expect(screen.getByTestId('live-idle')).toBeInTheDocument())
      expect(screen.queryByText('Session')).not.toBeInTheDocument()
      expect(screen.queryByText(/Site profile/)).not.toBeInTheDocument()
      // MobileNav still renders during idle — it's the only way off this
      // screen at all on a real phone, phase notwithstanding.
      expect(screen.getByRole('button', { name: 'Tonight' })).toBeInTheDocument()
    })
  })

  it('the telemetry grid uses minmax(0,1fr), not a bare 1fr, so a label cannot overflow the container', () => {
    // Regression guard for the exact bug the design's own handoff warns
    // about twice (README.md:450) — a bare `1fr`'s min-content default
    // overflowed the prototype's container. Read from source: jsdom does not
    // compute intrinsic min-content sizing, so this property cannot be
    // observed by measuring a rendered grid in this test environment.
    const css = readFileSync(join(__dirname, 'TelemetryGrid.module.css'), 'utf8')
    const gridRule = css.match(/\.grid\s*\{[^}]*\}/)?.[0] ?? ''
    expect(gridRule).toMatch(/minmax\(0,\s*1fr\)/)
    expect(gridRule).not.toMatch(/repeat\(3,\s*1fr\)/)
  })
})

/**
 * `get_run_state` — the tool that replaced inferring a live session from a
 * `get_view_state` timeout. Two consequences worth pinning: the guardrail
 * finally gets the scope's real session start, and a parked scope stops
 * being polled every minute.
 *
 * The default stub above deliberately does NOT serve `/api/get_run_state`,
 * so every other test in this file exercises the fail-open path: the fetch
 * 404s, `fetchRunState` rejects, and the device check happens anyway. That
 * is the intended behaviour against an older server, and it is why adding
 * this tool changed no existing expectation.
 */
/** Resolve with the first fetched URL containing `fragment`. Waits on the
 * call rather than on a DOM element: these tests are about which requests are
 * made with which arguments, and a rendered target name is a weaker proxy
 * that also depends on the preview and observability chain. */
async function waitForFetch(fragment: string): Promise<string> {
  let found: string | undefined
  await waitFor(() => {
    const calls = (globalThis.fetch as unknown as { mock: { calls: [string][] } }).mock.calls
    found = calls.map(([u]) => u).find((u) => u.includes(fragment))
    expect(found).toBeDefined()
  })
  return found!
}

/** The recorded/hand-built payloads, with only the field under test varied.
 *
 * These used to be two near-identical object literals declared in two
 * `describe` blocks, while `fixtures/synthetic/run_state.{active,idle}.json`
 * sat unreferenced — and the literals were the weaker copy: they dropped
 * `targets_remaining`, whose PRESENT-vs-OMITTED distinction is the thing
 * those fixtures were built to pin (`[]` and "not tracked" mean opposite
 * things). Starting from the fixture means a shape change upstream reaches
 * these tests instead of stopping at a hand-written stand-in. */
const runState = (state: string, sessionStart: string) => {
  const base = runStateActiveFixture() as { run: Record<string, unknown> }
  return { ...base, state, run: { ...base.run, session_start_utc: sessionStart } }
}

describe('get_run_state', () => {
  it('passes the scope’s real session start to the guardrail, not browser-open', async () => {
    // Handback item 20. This governs a hard stop, and the old behaviour —
    // timing from when the tab opened — UNDERSTATED elapsed time for anyone
    // who connected mid-session, which is the dangerous direction.
    const REAL_START = '2026-08-02T19:04:11.500000+00:00'
    stubApi({ '/api/get_run_state': runState('active', REAL_START) })

    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)

    const guardrail = await waitForFetch('check_night_guardrails')

    expect(decodeURIComponent(guardrail)).toContain(REAL_START)
  })

  it('falls back to since-I-started-watching when the run carries no start', async () => {
    // An idle scope driven by hand writes no run_state.json, so there is no
    // real start to use. The old fallback stays — narrower, not gone.
    stubApi({ '/api/get_run_state': runStateIdle() })

    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)

    // Still called, still with something — just not the scope's own start.
    expect(await waitForFetch('check_night_guardrails')).toMatch(/session_start_utc=/)
  })

  it('still checks the device on the first idle poll', async () => {
    // The back-off must never delay the first look, or opening the screen on
    // a hand-driven session would show nothing for five minutes.
    //
    // The device check is `get_view_state`, not `get_status`. This assertion
    // used to name get_status and was right at the time: it was the first
    // call every tick. After the probe inversion, an active tick never calls
    // get_status at all, so asserting on it would pass or fail for reasons
    // unrelated to whether the device was checked.
    stubApi({ '/api/get_run_state': runStateIdle() })

    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)

    expect(await waitForFetch('get_view_state')).toContain('get_view_state')
  })

  it('does not call get_status at all while a session is active', async () => {
    // The saving itself. get_view_state answering has already proved the
    // bridge is up, so the five-request connection check is redundant on
    // exactly the ticks where the control link is busiest. 6 device requests
    // per active tick down to 1.
    stubApi({ '/api/get_run_state': { ok: true, state: 'active', run: null } })

    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitForFetch('check_night_guardrails')  // active path reached

    const calls = (globalThis.fetch as unknown as { mock: { calls: [string][] } }).mock.calls
    expect(calls.map(([u]) => u).some((u) => u.includes('get_status'))).toBe(false)
  })
})

describe('run state is only trusted when active', () => {
  it('shows the run\'s real start in the target header while the run is active', async () => {
    stubApi({ '/api/get_run_state': runStateActiveFixture() })
    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    expect(await screen.findByTestId('session-started')).toHaveTextContent('started')
  })

  it('shows no start when the run is not active — the fallback is when this tab looked, not a start', async () => {
    stubApi({ '/api/get_run_state': runState('unknown', '2026-07-30T02:00:00.000000+00:00') })
    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() => expect(screen.getByTestId('telemetry-grid')).toBeInTheDocument())
    expect(screen.queryByTestId('session-started')).not.toBeInTheDocument()
  })

  it('ignores session_start_utc from an unknown (stale) run record', async () => {
    // `unknown` retains the previous run's fields by design — a stamp too old
    // to vouch for. Feeding that into check_night_guardrails, which governs a
    // hard stop, reports an abandoned session's age as the current one's.
    // This is exactly the misuse we warned seestar-mcp about and then wrote.
    const ABANDONED = '2026-07-30T02:00:00.000000+00:00'
    stubApi({ '/api/get_run_state': runState('unknown', ABANDONED) })

    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)

    const guardrail = await waitForFetch('check_night_guardrails')
    expect(decodeURIComponent(guardrail)).not.toContain(ABANDONED)
  })

  it('still trusts it when the run is active', async () => {
    const REAL = '2026-08-02T19:04:11.500000+00:00'
    stubApi({ '/api/get_run_state': runState('active', REAL) })

    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)

    expect(decodeURIComponent(await waitForFetch('check_night_guardrails'))).toContain(REAL)
  })
})

describe('under StrictMode (as main.tsx renders it in dev)', () => {
  it('reaches the live session on the first poll, not after the idle back-off', async () => {
    // StrictMode mounts, cleans up and re-mounts the effect. The cancelled
    // first poll still counted its idle run_state answer, so the real poll
    // saw idleTicks 2, skipped the device, and `npm run dev` sat on the
    // skeleton for ~5 minutes against a scope that was stacking.
    stubApi({ '/api/get_run_state': runStateIdle() })
    render(
      <StrictMode>
        <LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />
      </StrictMode>,
    )
    await waitFor(() => expect(screen.getByTestId('telemetry-grid')).toBeInTheDocument())
  })
})

/** Captured on hardware 2026-07-31 (see schemas.test.ts): scope connected and
 * tracking, no view session. `result` is `{}` — the `View` key is absent. */
const connectedButIdleViewState = () => ({
  ok: true,
  view_state: {
    jsonrpc: '2.0',
    Timestamp: '2439.848473865',
    method: 'get_view_state',
    result: {},
    code: 0,
    id: 10054,
  },
})

const fetchedUrls = (): string[] =>
  (globalThis.fetch as unknown as { mock: { calls: [string][] } }).mock.calls.map(([u]) => u)

describe('a connected scope with no view session', () => {
  it('renders idle — not a live session — when get_view_state answers with no View', async () => {
    // The commonest real state of this screen. It parses (the schema accepts
    // an absent View), and a successful fetch used to mean "active": a green
    // live dot, "Stacking", a column of dashes and a guardrails fetch for a
    // session that does not exist.
    stubApi({ '/api/get_view_state': connectedButIdleViewState() })
    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)

    await waitFor(() => expect(screen.getByTestId('live-idle')).toBeInTheDocument())
    expect(screen.queryByTestId('telemetry-grid')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('dot')[1]).toHaveAttribute('data-dot', 'idle')
  })

  it('asks nothing further of the scope or the share once it has answered with no View', async () => {
    // get_status would only re-prove a bridge that just answered, and
    // live_preview with no View scans the whole share and names an old target.
    stubApi({ '/api/get_view_state': connectedButIdleViewState() })
    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)

    await waitFor(() => expect(screen.getByTestId('live-idle')).toBeInTheDocument())
    const urls = fetchedUrls()
    expect(urls.some((u) => u.includes('get_status'))).toBe(false)
    expect(urls.some((u) => u.includes('check_night_guardrails'))).toBe(false)
    expect(urls.some((u) => u.includes('live_preview'))).toBe(false)
    expect(urls.some((u) => u.includes('last_stack'))).toBe(false)
  })
})

describe('never idle while get_run_state says a run is active', () => {
  it.each([
    ['get_view_state times out', { ok: false, error: 'get_view_state timed out' }],
    ['get_view_state reports no View', connectedButIdleViewState()],
  ])('shows the run, not "Scope idle", when %s', async (_label, viewReply) => {
    // An active run between targets (slewing, re-aligning) or one whose view
    // stopped unexpectedly: the scope's own view check says nothing is
    // stacking, but a skill-driven run is on. "Scope idle — not observing"
    // there is the confident wrong answer run_state exists to prevent.
    stubApi({ '/api/get_run_state': runStateActiveFixture(), '/api/get_view_state': viewReply })
    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)

    await waitFor(() => expect(screen.getByTestId('live-run-without-view')).toBeInTheDocument())
    expect(screen.queryByTestId('live-idle')).not.toBeInTheDocument()
    // Names the run's own target, from run_state.
    const runTarget = (runStateActiveFixture() as { run: { target: string } }).run.target
    expect(screen.getByTestId('live-run-without-view')).toHaveTextContent(runTarget)
    expect(screen.getAllByTestId('dot')[1]).not.toHaveAttribute('data-dot', 'idle')
    await waitFor(() => expect(screen.getByTestId('session-activity-list')).toBeInTheDocument())
    expect(screen.queryByTestId('session-activity-not-running')).not.toBeInTheDocument()
  })
})

describe('a session held through a failed poll', () => {
  // useLiveSession no longer ends a session on one failed read; it keeps the
  // last reading and flags it. The flag has to reach the screen, or a held
  // reading would pass for a fresh one.
  async function renderThroughOneFailedPoll(mobile: boolean) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    stubMatchMedia(mobile)
    let viewReply: Body = recordedViewState()
    stubApi({ '/api/get_view_state': () => viewReply })
    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(screen.queryByTestId('live-stale')).not.toBeInTheDocument()

    viewReply = { ok: false, error: 'get_view_state timed out' }
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS)
    })
  }

  afterEach(() => {
    vi.useRealTimers()
  })

  it('keeps the telemetry on screen, visibly marked stale, with why', async () => {
    await renderThroughOneFailedPoll(false)

    expect(screen.getByTestId('live-stale')).toHaveTextContent(/get_view_state timed out/)
    expect(screen.getByTestId('telemetry-grid')).toBeInTheDocument()
    expect(screen.queryByTestId('live-idle')).not.toBeInTheDocument()
    // Not the green "live" dot: this is not a live reading.
    expect(screen.getAllByTestId('dot')[1]).toHaveAttribute('data-dot', 'marginal')
    // Nor can the feed claim a session is, or is not, running.
    expect(screen.queryByTestId('session-activity-not-running')).not.toBeInTheDocument()
  })

  it('marks it stale on mobile too', async () => {
    await renderThroughOneFailedPoll(true)

    expect(screen.getByTestId('live-stale')).toHaveTextContent(/get_view_state timed out/)
    expect(screen.getByTestId('mobile-live-tiles')).toBeInTheDocument()
  })
})

describe('the target name does not depend on the file share', () => {
  it('still names the target on mobile when live_preview reports share_unreachable', async () => {
    // Observed live on 2026-08-08, mid-session: the SMB share dropped and the
    // phone showed "Target unknown" while get_view_state was still answering
    // and still reporting 1075 stacked frames on M13.
    //
    // Mobile only. LiveScreen's DESKTOP branch already fell back to
    // `liveView?.target_name` (line ~195); the mobile branch did not, and
    // useLiveSession sourced currentTarget from live_preview's `target`
    // alone — so losing the share lost the name on the one surface you would
    // actually be holding in a field.
    //
    // Observability is stubbed to fail so the chain reduces to currentTarget,
    // which is the link this fixes; otherwise its own resolved common name
    // would satisfy the assertion for the wrong reason.
    const expected = ViewStateSchema.parse(recordedViewState()).view_state?.result?.View
      ?.target_name
    expect(expected).toBeTruthy()
    stubMatchMedia(true)
    stubApi({
      '/api/live_preview': { ok: true, source: null, reason: 'share_unreachable' },
      '/api/get_target_observability': undefined,
    })

    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)

    expect(await screen.findByText(expected!)).toBeInTheDocument()
    expect(screen.queryByText('Target unknown')).not.toBeInTheDocument()
  })
})
