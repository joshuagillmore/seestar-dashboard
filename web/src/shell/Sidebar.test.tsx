import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Sidebar } from './Sidebar'
import { SiteProfileSchema } from '../api/schemas'
import { recordedSite } from '../test/fixtures'

const site = SiteProfileSchema.parse(recordedSite())

describe('Sidebar', () => {
  it('reads floor and ceiling from the profile, not constants', () => {
    render(<Sidebar site={site} verdict="NO-GO" />)
    // Recorded profile is floor 20, ceiling 60 — the design's 25 must not appear.
    expect(screen.getByText(/floor 20°/)).toBeInTheDocument()
    expect(screen.getByText(/ceiling 60°/)).toBeInTheDocument()
    expect(screen.queryByText(/floor 25°/)).not.toBeInTheDocument()
  })

  it('renders an empty horizon mask as off', () => {
    render(<Sidebar site={site} verdict="NO-GO" />)
    expect(screen.getByText(/mask off/)).toBeInTheDocument()
    expect(screen.queryByText(/3 arcs/)).not.toBeInTheDocument()
  })

  it('shows the site name and Bortle from the profile', () => {
    render(<Sidebar site={site} verdict="NO-GO" />)
    expect(screen.getByText('Example Observatory (scope GPS)')).toBeInTheDocument()
    expect(screen.getByText(/Bortle 8/)).toBeInTheDocument()
  })

  it('marks screens that are not in slice 1 as unavailable', () => {
    render(<Sidebar site={site} verdict="NO-GO" />)
    expect(screen.getByRole('button', { name: /Tonight/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Live session/ })).toBeDisabled()
  })

  it('renders without a profile', () => {
    render(<Sidebar site={null} verdict={null} />)
    expect(screen.getByText('Session')).toBeInTheDocument()
  })

  it('gives the Tonight dot the verdict tone and leaves the rest idle', () => {
    // This assertion is only possible because every dot routes through <Dot>,
    // which guarantees data-dot. The Task 9 review found a guard querying that
    // attribute when nothing set it — it passed vacuously for a whole task.
    render(<Sidebar site={site} verdict="NO-GO" />)
    const dots = screen.getAllByTestId('dot')
    expect(dots).toHaveLength(4)
    expect(dots[0]).toHaveAttribute('data-dot', 'reject')
    expect(dots.slice(1).every((d) => d.getAttribute('data-dot') === 'idle')).toBe(true)
  })

  it('shows a pass dot only when the night is a GO', () => {
    const { rerender } = render(<Sidebar site={site} verdict="NO-GO" />)
    expect(screen.queryAllByTestId('dot').filter(
      (d) => d.getAttribute('data-dot') === 'pass',
    )).toHaveLength(0)
    rerender(<Sidebar site={site} verdict="GO" />)
    expect(screen.getAllByTestId('dot')[0]).toHaveAttribute('data-dot', 'pass')
  })
})
