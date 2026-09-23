import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TonightScreen } from './TonightScreen'
import { shortlistOrderLabel } from './shortlist'
import { ConditionsSchema, PlanTargetsSchema, SiteProfileSchema, type Health } from '../../api/schemas'
import { goConditions, recordedConditions, recordedPlan, recordedProjectsCombined, recordedSite } from '../../test/fixtures'
import { stubMatchMedia } from '../../test/matchMedia'

/** One card per ranked target — read from the fixture, not hardcoded. */
const plan = PlanTargetsSchema.parse(recordedPlan())
const planTargetCount = plan.targets.length
const recorded = ConditionsSchema.parse(recordedConditions())

// site/health are shell-level data owned by App.tsx's useShellData() and
// passed in as props (see TonightScreenProps) — TonightScreen no longer
// fetches either itself, so tests supply them directly rather than stubbing
// /api/get_site_profile or /api/health.
const site = SiteProfileSchema.parse(recordedSite())
const notReplaying: Health = { ok: true, replay: false }

function stubApi(overrides: Record<string, unknown> = {}) {
  const bodies: Record<string, unknown> = {
    '/api/assess_conditions': recordedConditions(),
    '/api/plan_targets?limit=12': recordedPlan(),
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
    render(<TonightScreen view="tonight" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    expect(screen.getByTestId('tonight-loading')).toBeInTheDocument()
  })

  it('renders the verdict, timeline and cards once loaded', async () => {
    stubApi()
    render(<TonightScreen view="tonight" onNavigate={vi.fn()} site={site} health={notReplaying} />)
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
    render(<TonightScreen view="tonight" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent(/unreachable/i)
  })

  it('captions the shortlist as ranked-for-reference on the recorded NO-GO night', async () => {
    stubApi()
    render(<TonightScreen view="tonight" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() =>
      expect(screen.getByText('NO-GO', { selector: 'div' })).toBeInTheDocument(),
    )
    expect(screen.getByText(/ranked for reference/i)).toBeInTheDocument()
  })

  it('omits the ranked-for-reference caption on a GO night', async () => {
    stubApi({ '/api/assess_conditions': goConditions() })
    render(<TonightScreen view="tonight" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() => expect(screen.getByText('GO', { selector: 'div' })).toBeInTheDocument())
    expect(screen.queryByText(/ranked for reference/i)).not.toBeInTheDocument()
  })

  it('shows the ranked-shortlist eyebrow regardless of verdict', async () => {
    stubApi()
    render(<TonightScreen view="tonight" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() =>
      expect(screen.getByText('NO-GO', { selector: 'div' })).toBeInTheDocument(),
    )
    expect(screen.getByText('plan_targets · ranked shortlist')).toBeInTheDocument()
  })

  it('shows the real order line — target order and slew count — on a GO night, in place of the no-go caption', async () => {
    stubApi({ '/api/assess_conditions': goConditions() })
    render(<TonightScreen view="tonight" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() => expect(screen.getByText('GO', { selector: 'div' })).toBeInTheDocument())
    // Asserts the actual computed label (order + slew count), not merely that
    // some "Order:" text exists — a test that only checked the prefix would
    // pass even if the slew count were wrong.
    expect(screen.getByText(shortlistOrderLabel(plan.targets))).toBeInTheDocument()
    expect(screen.queryByText(/ranked for reference/i)).not.toBeInTheDocument()
  })

  it('replaces the order line with the no-go caption on the recorded NO-GO night — the two never both show', async () => {
    stubApi()
    render(<TonightScreen view="tonight" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() =>
      expect(screen.getByText('NO-GO', { selector: 'div' })).toBeInTheDocument(),
    )
    expect(screen.getByText(/ranked for reference/i)).toBeInTheDocument()
    expect(screen.queryByText(shortlistOrderLabel(plan.targets))).not.toBeInTheDocument()
    expect(screen.queryByText(/^Order:/)).not.toBeInTheDocument()
  })

  // The three tests below guard the screen's OWN wiring — the individually
  // well-tested Sidebar/TopBar can each be correct in isolation while
  // TonightScreen still passes them a hardcoded or wrong prop. A prior review
  // found three mutations here (forced GO tone, forced replay=false, forced
  // gpsWarning=null) that left every other test green.
  it('gives the sidebar Tonight dot the reject tone on the recorded NO-GO night', async () => {
    stubApi()
    render(<TonightScreen view="tonight" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() =>
      expect(screen.getByText('NO-GO', { selector: 'div' })).toBeInTheDocument(),
    )
    // The Tonight nav row's dot is always the sidebar's first dot
    // (Sidebar.test.tsx pins this ordering).
    expect(screen.getAllByTestId('dot')[0]).toHaveAttribute('data-dot', 'reject')
  })

  it('does not show the replay badge when passed a non-replaying health prop', async () => {
    stubApi()
    render(<TonightScreen view="tonight" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() =>
      expect(screen.getByText('NO-GO', { selector: 'div' })).toBeInTheDocument(),
    )
    expect(screen.queryByText(/fixtures — not live/i)).not.toBeInTheDocument()
  })

  it('shows the replay badge when passed a replaying health prop', async () => {
    stubApi()
    render(
      <TonightScreen view="tonight" onNavigate={vi.fn()} site={site} health={{ ok: true, replay: true }} />,
    )
    await waitFor(() => expect(screen.getByText(/fixtures — not live/i)).toBeInTheDocument())
  })

  it('renders normally while site/health have not arrived yet (null props)', async () => {
    // App.tsx's useShellData() starts both at null; TonightScreen's own data
    // (conditions/plan) must not be gated on shell data that hasn't loaded.
    stubApi()
    render(<TonightScreen view="tonight" onNavigate={vi.fn()} site={null} health={null} />)
    await waitFor(() =>
      expect(screen.getByText('NO-GO', { selector: 'div' })).toBeInTheDocument(),
    )
    expect(screen.queryByText(/fixtures — not live/i)).not.toBeInTheDocument()
  })

  it('threads the GPS warning from assess_conditions to both the sidebar and the banner', async () => {
    // This briefly asserted exactly twice: the design puts the GPS row in
    // the banner (README.md:291-306), and Sidebar kept its own copy for an
    // interim period as an acknowledged double-render, not a regression
    // (see VerdictBanner.tsx's doc comment). Sidebar's copy has since been
    // removed (shell/), collapsing this back to the single render the design
    // always specified.
    stubApi()
    render(<TonightScreen view="tonight" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() =>
      expect(screen.getByText('NO-GO', { selector: 'div' })).toBeInTheDocument(),
    )
    const warning = recorded.location.warning
    if (!warning) throw new Error('recorded fixture must carry a GPS warning for this test to mean anything')
    expect(screen.getAllByText(warning)).toHaveLength(1)
  })

  it('threads location.matched to the sidebar, not just the warning string', async () => {
    // Regression test for a dead wire. Sidebar grew a `gpsMatched` prop to
    // tell apart the server's three location states — matched / unverified /
    // mismatch, the last of which means the horizon mask is NOT applied — but
    // TonightScreen was never updated to pass it, so the prop sat on its
    // `null` default and the row read "GPS unverified" whatever the server
    // said. The whole suite stayed green: Sidebar's own tests supplied the
    // prop directly, and every recorded fixture happens to carry
    // `matched: null`, which is also the default the broken wire fell back to.
    //
    // So this test has to use a fixture where matched is NOT null — otherwise
    // it passes with the wire cut, which is exactly how the gap survived.
    const matched = ConditionsSchema.parse({
      ...recorded,
      location: { ...recorded.location, matched: true, warning: null },
    })
    stubApi({ '/api/assess_conditions': matched })
    render(<TonightScreen view="tonight" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() =>
      expect(screen.getByText('NO-GO', { selector: 'div' })).toBeInTheDocument(),
    )
    // Match the sidebar's combined row specifically — the banner legitimately
    // says "GPS matched" too in this state, so a bare /GPS matched/ would pass
    // on the banner alone and prove nothing about the sidebar's wiring.
    expect(screen.getByText(/GPS matched · mask/)).toBeInTheDocument()
    expect(screen.queryByText(/GPS unverified · mask/)).not.toBeInTheDocument()
  })

  it('shows a time-captured progress row on ranked cards that match a real projects_combined target', async () => {
    stubApi({ '/api/projects_combined': recordedProjectsCombined() })
    render(<TonightScreen view="tonight" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() =>
      expect(screen.getByText('NO-GO', { selector: 'div' })).toBeInTheDocument(),
    )
    // M31 is both a plan_targets entry and a projects_combined entry with a
    // real suggested goal (2.9 h, see projects.test.ts) — joined client-side
    // by id (see TonightScreen.tsx), not recomputed.
    await waitFor(() => expect(screen.getByText('of 2.9 h suggested')).toBeInTheDocument())
  })

  it('renders the ranked cards normally, with no progress row, when projects_combined fails — it is an enhancement, not core to Tonight', async () => {
    stubApi() // projects_combined isn't stubbed here, so it 404s/fails schema validation and is soft-caught
    render(<TonightScreen view="tonight" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() =>
      expect(screen.getByText('NO-GO', { selector: 'div' })).toBeInTheDocument(),
    )
    expect(
      screen.getAllByRole('button', { name: /Hand to run-session/ }),
    ).toHaveLength(planTargetCount)
    expect(screen.queryByText('TIME CAPTURED')).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('threads view and onNavigate to the sidebar so switching screens actually works', async () => {
    stubApi()
    const onNavigate = vi.fn()
    render(<TonightScreen view="tonight" onNavigate={onNavigate} site={site} health={notReplaying} />)
    await waitFor(() =>
      expect(screen.getByText('NO-GO', { selector: 'div' })).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: /Tonight/ })).toHaveAttribute('aria-current', 'page')
    fireEvent.click(screen.getByRole('button', { name: /Projects/ }))
    expect(onNavigate).toHaveBeenCalledWith('projects')
  })

  describe('mobile breakpoint', () => {
    it('renders MobileTonightView and drops the AppShell chrome once the mobile breakpoint matches', async () => {
      stubMatchMedia(true)
      stubApi()
      render(<TonightScreen view="tonight" onNavigate={vi.fn()} site={site} health={notReplaying} />)
      await waitFor(() => expect(screen.getByTestId('mobile-shortlist')).toBeInTheDocument())
      // The desktop composition (VerdictBanner's own fact row, the sweet-band
      // timeline, PlanCard's ranked grid) must not also render.
      expect(screen.queryByTestId('fact-row')).not.toBeInTheDocument()
      expect(screen.queryByText(/sweet-band windows/i)).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Hand to run-session/ })).not.toBeInTheDocument()
      // No Sidebar, no TopBar wordmark — the only nav present is MobileNav.
      //
      // This used to assert "no button named /Projects/" as a stand-in for
      // "the Sidebar is gone", and broke the moment MobileNav legitimately
      // gained a Projects tab. A proxy for the property, not the property:
      // assert the chrome itself is absent and that the surviving nav is the
      // mobile one, which stays true however many tabs it carries.
      expect(screen.queryByText('seestar')).not.toBeInTheDocument()
      expect(screen.queryByText(/Site profile/i)).not.toBeInTheDocument()
      const navs = screen.getAllByRole('navigation')
      expect(navs.map((n) => n.getAttribute('aria-label'))).toEqual(['Mobile navigation'])
      expect(screen.getByRole('button', { name: 'Tonight' })).toHaveAttribute('aria-current', 'page')
      expect(screen.getByRole('button', { name: 'Live' })).toBeInTheDocument()
    })

    it('gives mobile a working nav — switching to Live actually calls onNavigate', async () => {
      stubMatchMedia(true)
      stubApi()
      const onNavigate = vi.fn()
      render(<TonightScreen view="tonight" onNavigate={onNavigate} site={site} health={notReplaying} />)
      await waitFor(() => expect(screen.getByTestId('mobile-shortlist')).toBeInTheDocument())
      fireEvent.click(screen.getByRole('button', { name: 'Live' }))
      expect(onNavigate).toHaveBeenCalledWith('live')
    })

    it('keeps the ordinary desktop layout, chrome included, when the mobile breakpoint does not match', async () => {
      stubMatchMedia(false)
      stubApi()
      render(<TonightScreen view="tonight" onNavigate={vi.fn()} site={site} health={notReplaying} />)
      await waitFor(() =>
        expect(screen.getByText('NO-GO', { selector: 'div' })).toBeInTheDocument(),
      )
      expect(screen.queryByTestId('mobile-shortlist')).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Projects/ })).toBeInTheDocument()
      expect(screen.getByText('seestar')).toBeInTheDocument()
    })

    it('shows the loading skeleton full-width, without AppShell chrome, before conditions/plan arrive at the mobile breakpoint', () => {
      stubMatchMedia(true)
      stubApi()
      render(<TonightScreen view="tonight" onNavigate={vi.fn()} site={site} health={notReplaying} />)
      expect(screen.getByTestId('tonight-loading')).toBeInTheDocument()
      expect(screen.queryByText('seestar')).not.toBeInTheDocument()
    })
  })
})

describe('Detail hands a target to Review & QA', () => {
  /** The plan fixture's targets against a projects_combined response we
   * control: the first has subs on disk, the second has store minutes only
   * (a session the server logged with no local FITS — nothing to score). */
  const combinedFor = (withArchive: string, storeOnly: string) => ({
    ok: true,
    count: 2,
    totals: { store_minutes: 60, archive_minutes: 120, total_minutes: 180 },
    projects: [
      { target_id: withArchive, target_name: withArchive, store_minutes: 0, archive_minutes: 120,
        sources: ['archive'], nights: [], total_minutes: 120, goal: null },
      { target_id: storeOnly, target_name: storeOnly, store_minutes: 60, archive_minutes: 0,
        sources: ['store'], nights: [], total_minutes: 60, goal: null },
    ],
  })

  /** The Detail button on the CARD for `targetId`.
   *
   * Scoped through `<article>` deliberately: the id also appears as a lane
   * name in the sweet-band timeline, so a bare getByText matches twice and
   * throws — the multiple-match trap this repo has hit before. */
  const cardFor = (targetId: string) => {
    const card = screen
      .getAllByText(targetId)
      .map((el) => el.closest('article'))
      .find((el): el is HTMLElement => el != null)
    if (!card) throw new Error(`no plan card for ${targetId}`)
    return card
  }

  const detailFor = (targetId: string) => {
    const btn = [...cardFor(targetId).querySelectorAll('button')].find((b) => b.textContent === 'Detail')
    if (!btn) throw new Error(`no Detail button for ${targetId}`)
    return btn
  }

  it('enables Detail only for targets with subs on disk, and navigates with the target', async () => {
    const [a, b] = plan.targets
    stubApi({ '/api/projects_combined': combinedFor(a.id, b.id) })
    const onNavigate = vi.fn()
    stubMatchMedia(false)

    render(<TonightScreen view="tonight" onNavigate={onNavigate} site={site} health={notReplaying} />)
    await waitFor(() => expect(detailFor(a.id)).toBeEnabled())

    // store_minutes alone is not reviewable — qa_targets is built from the
    // archive scan, so the Review picker would not contain this target.
    expect(detailFor(b.id)).toBeDisabled()

    fireEvent.click(detailFor(a.id))
    expect(onNavigate).toHaveBeenCalledWith('review')
    expect(window.sessionStorage.getItem('seestar.review.pendingTarget')).toBe(JSON.stringify(a.id))
  })

  it('leaves Detail disabled for every target when projects_combined fails', async () => {
    // The progress fetch is deliberately non-fatal (it degrades the cards
    // rather than the screen), so a failure must not leave Detail looking
    // clickable and doing nothing — the exact bug this replaced.
    const [a] = plan.targets
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/projects_combined') return { ok: false, status: 502, json: async () => ({ ok: false, error: 'down' }) }
      const bodies: Record<string, unknown> = {
        '/api/assess_conditions': recordedConditions(),
        '/api/plan_targets?limit=12': recordedPlan(),
      }
      return { ok: true, status: 200, json: async () => bodies[url] }
    }))
    stubMatchMedia(false)

    render(<TonightScreen view="tonight" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() => expect(cardFor(a.id)).toBeInTheDocument())
    expect(detailFor(a.id)).toBeDisabled()
  })

  it('says the lookup failed — not "no subs on disk" — when projects_combined fails', async () => {
    // Disabled is right; the old reason was false. Nothing was learned about
    // the disk: the question could not be asked.
    const [a] = plan.targets
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/projects_combined') return { ok: false, status: 502, json: async () => ({ ok: false, error: 'down' }) }
      const bodies: Record<string, unknown> = {
        '/api/assess_conditions': recordedConditions(),
        '/api/plan_targets?limit=12': recordedPlan(),
      }
      return { ok: true, status: 200, json: async () => bodies[url] }
    }))
    stubMatchMedia(false)

    render(<TonightScreen view="tonight" onNavigate={vi.fn()} site={site} health={notReplaying} />)

    await waitFor(() => expect(detailFor(a.id).title).toMatch(/could not check/i))
    expect(detailFor(a.id).title).not.toMatch(/No subs on disk/)
  })

  it('does not claim "no subs on disk" while the lookup is still in flight', async () => {
    const [a] = plan.targets
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === '/api/projects_combined') return new Promise(() => {})
      const bodies: Record<string, unknown> = {
        '/api/assess_conditions': recordedConditions(),
        '/api/plan_targets?limit=12': recordedPlan(),
      }
      return { ok: true, status: 200, json: async () => bodies[url] }
    }))
    stubMatchMedia(false)

    render(<TonightScreen view="tonight" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() => expect(cardFor(a.id)).toBeInTheDocument())

    expect(detailFor(a.id)).toBeDisabled()
    expect(detailFor(a.id).title).toMatch(/checking/i)
  })

  it('qualifies an unmatched id instead of asserting the target has no subs', async () => {
    // plan_targets says "C14"; projects_combined says "C14_DoubleCluster".
    // The join misses, and that is a server-side id mismatch (hand-back),
    // not evidence about the disk. The card must say what it actually knows:
    // nothing is on record UNDER THIS ID.
    stubApi({ '/api/projects_combined': recordedProjectsCombined() })
    stubMatchMedia(false)
    expect(plan.targets.some((t) => t.id === 'C14')).toBe(true)

    render(<TonightScreen view="tonight" onNavigate={vi.fn()} site={site} health={notReplaying} />)

    await waitFor(() => expect(detailFor('C14').title).toMatch(/under the id C14/))
    expect(detailFor('C14')).toBeDisabled()
    expect(detailFor('C14').title).not.toMatch(/No subs on disk for C14/)
  })
})
