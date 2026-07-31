import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LiveScreen } from './LiveScreen'
import { SiteProfileSchema, type Health } from '../../api/schemas'
import { stubMatchMedia } from '../../test/matchMedia'
import {
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
  sessionActivity,
} from '../../test/fixtures'

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
    expect(screen.getByTestId('session-activity-not-running')).toBeInTheDocument()
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

  it('renders the active session once get_status and get_view_state both succeed', async () => {
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

  it('falls back to idle (not a crash, and not fabricated telemetry) when get_view_state answers ok but is missing the view_state wrapper', async () => {
    // The exact bug an earlier version of ViewStateSchema had: reading
    // ok.result.View directly, one level shallower than the real
    // ok.view_state.result.View. That malformed-but-200-OK payload fails
    // schema validation inside fetchViewState, which useLiveSession reads as
    // "idle" — proving the wrapper is actually load-bearing, not just
    // documented.
    stubApi({
      '/api/get_view_state': { ok: true, result: { View: { stage: 'Stack' } } },
    })
    render(<LiveScreen view="live" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() => expect(screen.getByTestId('live-idle')).toBeInTheDocument())
    expect(screen.queryByTestId('telemetry-grid')).not.toBeInTheDocument()
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
    // about twice (README.md:424) — a bare `1fr`'s min-content default
    // overflowed the prototype's container. Read from source: jsdom does not
    // compute intrinsic min-content sizing, so this property cannot be
    // observed by measuring a rendered grid in this test environment.
    const css = readFileSync(join(__dirname, 'TelemetryGrid.module.css'), 'utf8')
    const gridRule = css.match(/\.grid\s*\{[^}]*\}/)?.[0] ?? ''
    expect(gridRule).toMatch(/minmax\(0,\s*1fr\)/)
    expect(gridRule).not.toMatch(/repeat\(3,\s*1fr\)/)
  })
})
