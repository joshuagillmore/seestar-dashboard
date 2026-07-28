import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Sidebar } from './Sidebar'
import { SiteProfileSchema } from '../api/schemas'
import { recordedSite } from '../test/fixtures'

const site = SiteProfileSchema.parse(recordedSite())

describe('Sidebar', () => {
  it('reads floor and ceiling from the profile, not constants', () => {
    render(<Sidebar site={site} verdict="NO-GO" gpsWarning={null} />)
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
    render(<Sidebar site={southernEastern} verdict="NO-GO" gpsWarning={null} />)
    expect(screen.getByText(/33\.868 S/)).toBeInTheDocument()
    expect(screen.getByText(/151\.209 E/)).toBeInTheDocument()
    expect(screen.queryByText(/33\.868 N/)).not.toBeInTheDocument()
    expect(screen.queryByText(/151\.209 W/)).not.toBeInTheDocument()
    expect(screen.queryByText(/-33\.868/)).not.toBeInTheDocument()
    expect(screen.queryByText(/-151\.209/)).not.toBeInTheDocument()
  })

  it('renders an empty horizon mask as off', () => {
    render(<Sidebar site={site} verdict="NO-GO" gpsWarning={null} />)
    expect(screen.getByText(/mask off/)).toBeInTheDocument()
    expect(screen.queryByText(/3 arcs/)).not.toBeInTheDocument()
  })

  it('shows the site name and Bortle from the profile', () => {
    render(<Sidebar site={site} verdict="NO-GO" gpsWarning={null} />)
    expect(screen.getByText('Example Observatory (scope GPS)')).toBeInTheDocument()
    expect(screen.getByText(/Bortle 8/)).toBeInTheDocument()
  })

  it('marks screens that are not in slice 1 as unavailable', () => {
    render(<Sidebar site={site} verdict="NO-GO" gpsWarning={null} />)
    expect(screen.getByRole('button', { name: /Tonight/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Live session/ })).toBeDisabled()
  })

  it('renders without a profile', () => {
    render(<Sidebar site={null} verdict={null} gpsWarning={null} />)
    expect(screen.getByText('Session')).toBeInTheDocument()
  })

  it('gives the Tonight dot the verdict tone and leaves the rest idle', () => {
    // This assertion is only possible because every dot routes through <Dot>,
    // which guarantees data-dot. The Task 9 review found a guard querying that
    // attribute when nothing set it — it passed vacuously for a whole task.
    render(<Sidebar site={site} verdict="NO-GO" gpsWarning={null} />)
    // Five dots: four nav rows, then the GPS status row in the site block.
    const dots = screen.getAllByTestId('dot')
    expect(dots).toHaveLength(5)
    expect(dots[0]).toHaveAttribute('data-dot', 'reject')
    expect(dots.slice(1, 4).every((d) => d.getAttribute('data-dot') === 'idle')).toBe(true)
  })

  it('carries the GPS warning verbatim instead of claiming a match', () => {
    // The real installation has never GPS-matched. Rendering the design's
    // confident "GPS matched" row would assert something nobody verified.
    const warning = "GPS unverified — assuming saved site 'Example Observatory (scope GPS)'."
    render(<Sidebar site={site} verdict="NO-GO" gpsWarning={warning} />)
    expect(screen.getByText(warning)).toBeInTheDocument()
    expect(screen.queryByText('GPS matched')).not.toBeInTheDocument()
    const dots = screen.getAllByTestId('dot')
    expect(dots[dots.length - 1]).toHaveAttribute('data-dot', 'marginal')
  })

  it('shows a confirmed GPS row when there is no warning', () => {
    render(<Sidebar site={site} verdict="NO-GO" gpsWarning={null} />)
    expect(screen.getByText('GPS matched')).toBeInTheDocument()
    const dots = screen.getAllByTestId('dot')
    expect(dots[dots.length - 1]).toHaveAttribute('data-dot', 'pass')
  })

  it('gives the Tonight nav dot a pass tone only on a GO', () => {
    // Scoped to dots[0] deliberately: the GPS row also renders a pass dot when
    // the site is confirmed, so a whole-tree "no pass dot" assertion would be
    // testing the wrong thing.
    const { rerender } = render(<Sidebar site={site} verdict="NO-GO" gpsWarning={null} />)
    expect(screen.getAllByTestId('dot')[0]).toHaveAttribute('data-dot', 'reject')
    rerender(<Sidebar site={site} verdict="GO" gpsWarning={null} />)
    expect(screen.getAllByTestId('dot')[0]).toHaveAttribute('data-dot', 'pass')
  })
})
