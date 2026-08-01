import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Sidebar } from './Sidebar'
import { SiteProfileSchema } from '../api/schemas'
import { recordedSite } from '../test/fixtures'

const site = SiteProfileSchema.parse(recordedSite())
const withMask = SiteProfileSchema.parse({
  ok: true,
  profile: { ...site.profile, horizon_mask: [{}, {}, {}] },
})

describe('Sidebar', () => {
  it('reads floor and ceiling from the profile, not constants', () => {
    render(<Sidebar site={site} verdict="NO-GO" gpsWarning={null} view="tonight" onNavigate={vi.fn()} />)
    // Recorded profile is floor 20, ceiling 60 — the design's 25 must not appear.
    expect(screen.getByText(/floor 20°/)).toBeInTheDocument()
    expect(screen.getByText(/ceiling 60°/)).toBeInTheDocument()
    expect(screen.queryByText(/floor 25°/)).not.toBeInTheDocument()
  })

  it('derives hemisphere letters from the sign, not a hardcoded N/W', () => {
    // Recorded profile is Example Observatory: lat +51.4778 (N), lon -0.0015 (W) — a site where
    // hardcoding "N"/"W" happens to look right. A southern, eastern site is
    // the one case that actually exercises the sign.
    const southernEastern = SiteProfileSchema.parse({
      ok: true,
      profile: { ...site.profile, lat_deg: -33.868, lon_deg: 151.209 },
    })
    render(
      <Sidebar site={southernEastern} verdict="NO-GO" gpsWarning={null} view="tonight" onNavigate={vi.fn()} />,
    )
    expect(screen.getByText(/33\.868 S/)).toBeInTheDocument()
    expect(screen.getByText(/151\.209 E/)).toBeInTheDocument()
    expect(screen.queryByText(/33\.868 N/)).not.toBeInTheDocument()
    expect(screen.queryByText(/151\.209 W/)).not.toBeInTheDocument()
    expect(screen.queryByText(/-33\.868/)).not.toBeInTheDocument()
    expect(screen.queryByText(/-151\.209/)).not.toBeInTheDocument()
  })

  it('renders an empty horizon mask as off', () => {
    render(<Sidebar site={site} verdict="NO-GO" gpsWarning={null} view="tonight" onNavigate={vi.fn()} />)
    expect(screen.getByText(/mask off/)).toBeInTheDocument()
    expect(screen.queryByText(/3 arcs/)).not.toBeInTheDocument()
  })

  it('shows the site name and Bortle from the profile', () => {
    render(<Sidebar site={site} verdict="NO-GO" gpsWarning={null} view="tonight" onNavigate={vi.fn()} />)
    expect(screen.getByText('Example Observatory')).toBeInTheDocument()
    expect(screen.getByText(/Bortle 8/)).toBeInTheDocument()
  })

  it('has all four screens available now that Review has shipped', () => {
    render(<Sidebar site={site} verdict="NO-GO" gpsWarning={null} view="tonight" onNavigate={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Tonight/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Live session/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Review & QA/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Projects/ })).toBeEnabled()
    // No slice-N placeholder text survives anywhere in the rail.
    expect(screen.queryByText(/^slice \d$/)).not.toBeInTheDocument()
  })

  it('does not give Review the Projects headline', () => {
    // The meta chain used to end in an `else` that returned projectsHeadline.
    // Harmless while Review was disabled (its meta was "slice 4"); the moment
    // slice 4 shipped it would have printed the Projects hours on the Review
    // row. Caught when enabling the row, pinned so it cannot come back.
    render(
      <Sidebar
        site={site}
        verdict="NO-GO"
        gpsWarning={null}
        view="tonight"
        onNavigate={vi.fn()}
        projectsHeadline="30.6 h"
      />,
    )
    expect(screen.getByRole('button', { name: /Projects/ })).toHaveTextContent('30.6 h')
    expect(screen.getByRole('button', { name: /Review & QA/ })).not.toHaveTextContent('30.6 h')
  })

  it('renders without a profile', () => {
    render(<Sidebar site={null} verdict={null} gpsWarning={null} view="tonight" onNavigate={vi.fn()} />)
    expect(screen.getByText('Session')).toBeInTheDocument()
  })

  it('gives the Tonight dot the verdict tone and leaves the rest idle', () => {
    // This assertion is only possible because every dot routes through <Dot>,
    // which guarantees data-dot. The Task 9 review found a guard querying that
    // attribute when nothing set it — it passed vacuously for a whole task.
    render(<Sidebar site={site} verdict="NO-GO" gpsWarning={null} view="tonight" onNavigate={vi.fn()} />)
    // Five dots: four nav rows, then the GPS/mask status row in the site
    // block (see the GPS-row tests below — it's a short-form complement to
    // the Tonight banner's own copy, not a duplicate of it).
    const dots = screen.getAllByTestId('dot')
    expect(dots).toHaveLength(5)
    expect(dots[0]).toHaveAttribute('data-dot', 'reject')
    // Indices 1-2 are Live and Review — neither has a verdict-like signal to
    // report, so both stay idle. Index 3 (Projects) is asserted separately
    // below, since its tone now depends on `projectsNeedsData`.
    expect(dots.slice(1, 3).every((d) => d.getAttribute('data-dot') === 'idle')).toBe(true)
  })

  it('gives the Projects nav dot a marginal tone when projects need data, and pass when none do', () => {
    const { rerender } = render(
      <Sidebar
        site={site}
        verdict="NO-GO"
        gpsWarning={null}
        view="tonight"
        onNavigate={vi.fn()}
        projectsNeedsData={3}
      />,
    )
    // dots[3] is Projects (Tonight, Live, Review, Projects, in that order).
    expect(screen.getAllByTestId('dot')[3]).toHaveAttribute('data-dot', 'marginal')

    rerender(
      <Sidebar
        site={site}
        verdict="NO-GO"
        gpsWarning={null}
        view="tonight"
        onNavigate={vi.fn()}
        projectsNeedsData={0}
      />,
    )
    expect(screen.getAllByTestId('dot')[3]).toHaveAttribute('data-dot', 'pass')
  })

  it('leaves the Projects nav dot idle when no needs-data count has been supplied — every screen but the mounted ProjectsScreen', () => {
    render(<Sidebar site={site} verdict="NO-GO" gpsWarning={null} view="tonight" onNavigate={vi.fn()} />)
    expect(screen.getAllByTestId('dot')[3]).toHaveAttribute('data-dot', 'idle')
  })

  // Design-review item B4, resolved: the design has a GPS row in BOTH the
  // sidebar (README.md:249-250, short form) and the Tonight verdict banner
  // (README.md:273-274, the full sentence) — complementary, not duplicated.
  // Printing the same long sentence in both places (briefly the case here)
  // was the actual bug; deleting the sidebar's row entirely would have been
  // the wrong fix, since the design specifies both.
  //
  // `gpsMatched` (`location.matched`) is a genuine three-state field, not a
  // boolean — `true`/`false`/`null` all mean something different (see
  // SidebarProps's own doc comment for the source verification against
  // SeeStar-AI's `_location_block`), so all three get their own test rather
  // than collapsing "never checked" and "confirmed elsewhere" into one
  // assumed-equivalent case.

  it('gpsMatched: true — "GPS matched" paired with the mask state, pass tone', () => {
    render(<Sidebar site={site} verdict="NO-GO" gpsWarning={null} gpsMatched={true} view="tonight" onNavigate={vi.fn()} />)
    expect(screen.getByText('GPS matched · mask off')).toBeInTheDocument()
    const dots = screen.getAllByTestId('dot')
    expect(dots[dots.length - 1]).toHaveAttribute('data-dot', 'pass')
  })

  it('gpsMatched: null — "GPS unverified" paired with the mask state (still applied), marginal tone, never the full warning sentence', () => {
    // The real installation's only-ever-observed state: GPS unknown, mask
    // still applied (assumed saved site) per _location_block's first branch.
    const warning = "GPS unverified — assuming saved site 'Example Observatory'."
    render(
      <Sidebar site={site} verdict="NO-GO" gpsWarning={warning} gpsMatched={null} view="tonight" onNavigate={vi.fn()} />,
    )
    expect(screen.getByText('GPS unverified · mask off')).toBeInTheDocument()
    // The full sentence belongs to VerdictBanner alone — the sidebar must
    // never repeat it verbatim, even though it's still threaded through as
    // the (now unused) gpsWarning prop.
    expect(screen.queryByText(warning)).not.toBeInTheDocument()
    const dots = screen.getAllByTestId('dot')
    expect(dots[dots.length - 1]).toHaveAttribute('data-dot', 'marginal')
  })

  it('gpsMatched: undefined (not yet threaded by a caller) degrades to the same treatment as null, not a crash or a false "matched"', () => {
    render(<Sidebar site={site} verdict="NO-GO" gpsWarning={null} view="tonight" onNavigate={vi.fn()} />)
    expect(screen.getByText('GPS unverified · mask off')).toBeInTheDocument()
  })

  it('gpsMatched: false — "GPS mismatch · mask not applied", never the configured arc count, even when a mask IS configured', () => {
    // The one branch a naive fix gets wrong: _location_block sets
    // mask_applied=false here specifically, so showing "mask on (3 arcs)"
    // from the configured horizon_mask alone (as horizon_mask.length would
    // do on its own) would tell the user a mask is protecting them when the
    // server has stopped applying it.
    render(
      <Sidebar site={withMask} verdict="NO-GO" gpsWarning={null} gpsMatched={false} view="tonight" onNavigate={vi.fn()} />,
    )
    expect(screen.getByText('GPS mismatch · mask not applied')).toBeInTheDocument()
    expect(screen.queryByText(/3 arcs/)).not.toBeInTheDocument()
    const dots = screen.getAllByTestId('dot')
    expect(dots[dots.length - 1]).toHaveAttribute('data-dot', 'marginal')
  })

  it('folds the mask state into the GPS row rather than a separate line', () => {
    // Regression guard for the smaller divergence the same fix corrects:
    // "mask …" used to be its own siteMeta line: README.md:249-250 has it
    // sharing the GPS row instead.
    render(
      <Sidebar site={withMask} verdict="NO-GO" gpsWarning={null} gpsMatched={true} view="tonight" onNavigate={vi.fn()} />,
    )
    expect(screen.getByText('GPS matched · mask on (3 arcs)')).toBeInTheDocument()
  })

  it('gives the Tonight nav dot a pass tone only on a GO', () => {
    // Scoped to dots[0] deliberately: the GPS/mask row also renders a pass
    // dot when the site is confirmed, so a whole-tree "no pass dot" assertion
    // would be testing the wrong thing.
    const { rerender } = render(
      <Sidebar site={site} verdict="NO-GO" gpsWarning={null} view="tonight" onNavigate={vi.fn()} />,
    )
    expect(screen.getAllByTestId('dot')[0]).toHaveAttribute('data-dot', 'reject')
    rerender(<Sidebar site={site} verdict="GO" gpsWarning={null} view="tonight" onNavigate={vi.fn()} />)
    expect(screen.getAllByTestId('dot')[0]).toHaveAttribute('data-dot', 'pass')
  })

  it('marks the currently active view with aria-current, and only that one', () => {
    render(<Sidebar site={site} verdict="NO-GO" gpsWarning={null} view="projects" onNavigate={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Projects/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: /Tonight/ })).not.toHaveAttribute('aria-current')
  })

  it('calls onNavigate with the target view when an enabled nav button is clicked', () => {
    const onNavigate = vi.fn()
    render(<Sidebar site={site} verdict="NO-GO" gpsWarning={null} view="tonight" onNavigate={onNavigate} />)
    fireEvent.click(screen.getByRole('button', { name: /Projects/ }))
    expect(onNavigate).toHaveBeenCalledTimes(1)
    expect(onNavigate).toHaveBeenCalledWith('projects')
  })

  it('calls onNavigate for Review, now that it is enabled', () => {
    // Replaces "never calls onNavigate for a disabled nav button". That test
    // pinned the disabled mechanism through the only row that used it; with
    // all four screens shipped, nothing sets disabledLabel and the mechanism
    // was removed rather than left as an untested branch in navigation.
    const onNavigate = vi.fn()
    render(<Sidebar site={site} verdict="NO-GO" gpsWarning={null} view="tonight" onNavigate={onNavigate} />)
    fireEvent.click(screen.getByRole('button', { name: /Review & QA/ }))
    expect(onNavigate).toHaveBeenCalledWith('review')
  })

  it('calls onNavigate for Live session, now that it is enabled', () => {
    const onNavigate = vi.fn()
    render(<Sidebar site={site} verdict="NO-GO" gpsWarning={null} view="tonight" onNavigate={onNavigate} />)
    fireEvent.click(screen.getByRole('button', { name: /Live session/ }))
    expect(onNavigate).toHaveBeenCalledWith('live')
  })

  it('gives the Live nav dot the supplied tone, defaulting to idle when none is passed', () => {
    const { rerender } = render(
      <Sidebar site={site} verdict="NO-GO" gpsWarning={null} view="tonight" onNavigate={vi.fn()} />,
    )
    // dots[1] is Live (Tonight, Live, Review, Projects, in that order).
    expect(screen.getAllByTestId('dot')[1]).toHaveAttribute('data-dot', 'idle')

    rerender(
      <Sidebar
        site={site}
        verdict="NO-GO"
        gpsWarning={null}
        view="tonight"
        onNavigate={vi.fn()}
        liveTone="pass"
        liveMeta="live"
      />,
    )
    const dots = screen.getAllByTestId('dot')
    expect(dots[1]).toHaveAttribute('data-dot', 'pass')
    expect(screen.getByRole('button', { name: /Live session/ })).toHaveTextContent('live')

    rerender(
      <Sidebar
        site={site}
        verdict="NO-GO"
        gpsWarning={null}
        view="tonight"
        onNavigate={vi.fn()}
        liveTone="reject"
        liveMeta="bridge down"
      />,
    )
    expect(screen.getAllByTestId('dot')[1]).toHaveAttribute('data-dot', 'reject')
    expect(screen.getByRole('button', { name: /Live session/ })).toHaveTextContent('bridge down')
  })

  it('shows a dash for the Live meta when none is supplied', () => {
    render(<Sidebar site={site} verdict="NO-GO" gpsWarning={null} view="tonight" onNavigate={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Live session/ })).toHaveTextContent('—')
  })

  it('shows a dash for the Projects meta when no headline is supplied', () => {
    render(<Sidebar site={site} verdict="NO-GO" gpsWarning={null} view="tonight" onNavigate={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Projects/ })).toHaveTextContent('—')
  })

  it('shows the real headline once the Projects screen supplies one', () => {
    render(
      <Sidebar
        site={site}
        verdict="NO-GO"
        gpsWarning={null}
        view="projects"
        onNavigate={vi.fn()}
        projectsHeadline="30.6 h"
      />,
    )
    expect(screen.getByRole('button', { name: /Projects/ })).toHaveTextContent('30.6 h')
  })
})
