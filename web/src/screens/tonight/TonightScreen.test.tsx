import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TonightScreen } from './TonightScreen'
import { ConditionsSchema, PlanTargetsSchema } from '../../api/schemas'
import { goConditions, recordedConditions, recordedPlan, recordedSite } from '../../test/fixtures'

/** One card per ranked target — read from the fixture, not hardcoded. */
const planTargetCount = PlanTargetsSchema.parse(recordedPlan()).targets.length
const recorded = ConditionsSchema.parse(recordedConditions())

function stubApi(overrides: Record<string, unknown> = {}) {
  const bodies: Record<string, unknown> = {
    '/api/assess_conditions': recordedConditions(),
    '/api/plan_targets?limit=12': recordedPlan(),
    '/api/get_site_profile': recordedSite(),
    '/api/health': { ok: true, replay: false },
    ...overrides,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => bodies[url] })),
  )
}

afterEach(() => vi.unstubAllGlobals())

describe('TonightScreen', () => {
  it('shows a loading state first', () => {
    stubApi()
    render(<TonightScreen view="tonight" onNavigate={vi.fn()} />)
    expect(screen.getByTestId('tonight-loading')).toBeInTheDocument()
  })

  it('renders the verdict, timeline and cards once loaded', async () => {
    stubApi()
    render(<TonightScreen view="tonight" onNavigate={vi.fn()} />)
    // Two collisions appear only once the components are assembled, and
    // neither is visible when each is tested in isolation:
    //   "NO-GO" renders twice — the sidebar's nav meta (a <span>) and the
    //   banner's headline word (a <div>) — so scope by tag to mean the banner.
    //   "M76" renders twice too — the timeline lane label and the plan card id
    //   — so assert presence rather than a single match.
    await waitFor(() =>
      expect(screen.getByText('NO-GO', { selector: 'div' })).toBeInTheDocument(),
    )
    expect(screen.getByText(/sweet-band windows/i)).toBeInTheDocument()
    // Assert something ONLY PlanCard can produce. An earlier version used
    // getAllByText('M76'), which the timeline's lane label satisfies on its own
    // — both are spans — so it passed even if the card grid were deleted, i.e.
    // it verified nothing about the wiring this task exists to deliver.
    expect(
      screen.getAllByRole('button', { name: /Hand to run-session/ }),
    ).toHaveLength(planTargetCount)
  })

  it('shows an error banner when the sidecar is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    render(<TonightScreen view="tonight" onNavigate={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent(/unreachable/i)
  })

  it('captions the shortlist as ranked-for-reference on the recorded NO-GO night', async () => {
    stubApi()
    render(<TonightScreen view="tonight" onNavigate={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByText('NO-GO', { selector: 'div' })).toBeInTheDocument(),
    )
    expect(screen.getByText(/ranked for reference/i)).toBeInTheDocument()
  })

  it('omits the ranked-for-reference caption on a GO night', async () => {
    stubApi({ '/api/assess_conditions': goConditions() })
    render(<TonightScreen view="tonight" onNavigate={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('GO', { selector: 'div' })).toBeInTheDocument())
    expect(screen.queryByText(/ranked for reference/i)).not.toBeInTheDocument()
  })

  // The three tests below guard the screen's OWN wiring — the individually
  // well-tested Sidebar/TopBar can each be correct in isolation while
  // TonightScreen still passes them a hardcoded or wrong prop. A prior review
  // found three mutations here (forced GO tone, forced replay=false, forced
  // gpsWarning=null) that left every other test green.
  it('gives the sidebar Tonight dot the reject tone on the recorded NO-GO night', async () => {
    stubApi()
    render(<TonightScreen view="tonight" onNavigate={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByText('NO-GO', { selector: 'div' })).toBeInTheDocument(),
    )
    // The Tonight nav row's dot is always the sidebar's first dot
    // (Sidebar.test.tsx pins this ordering).
    expect(screen.getAllByTestId('dot')[0]).toHaveAttribute('data-dot', 'reject')
  })

  it('does not show the replay badge when /api/health reports replay: false', async () => {
    stubApi()
    render(<TonightScreen view="tonight" onNavigate={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByText('NO-GO', { selector: 'div' })).toBeInTheDocument(),
    )
    expect(screen.queryByText(/fixtures — not live/i)).not.toBeInTheDocument()
  })

  it('shows the replay badge when /api/health reports replay: true', async () => {
    stubApi({ '/api/health': { ok: true, replay: true } })
    render(<TonightScreen view="tonight" onNavigate={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/fixtures — not live/i)).toBeInTheDocument())
  })

  it('threads the GPS warning from assess_conditions to the sidebar, exactly once', async () => {
    stubApi()
    render(<TonightScreen view="tonight" onNavigate={vi.fn()} />)
    await waitFor(() =>
      expect(screen.getByText('NO-GO', { selector: 'div' })).toBeInTheDocument(),
    )
    const warning = recorded.location.warning
    if (!warning) throw new Error('recorded fixture must carry a GPS warning for this test to mean anything')
    expect(screen.getAllByText(warning)).toHaveLength(1)
  })

  it('threads view and onNavigate to the sidebar so switching screens actually works', async () => {
    stubApi()
    const onNavigate = vi.fn()
    render(<TonightScreen view="tonight" onNavigate={onNavigate} />)
    await waitFor(() =>
      expect(screen.getByText('NO-GO', { selector: 'div' })).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: /Tonight/ })).toHaveAttribute('aria-current', 'page')
    fireEvent.click(screen.getByRole('button', { name: /Projects/ }))
    expect(onNavigate).toHaveBeenCalledWith('projects')
  })
})
