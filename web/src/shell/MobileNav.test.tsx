import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MobileNav } from './MobileNav'

describe('MobileNav', () => {
  it('renders exactly the two mobile screens — no Review, no Projects, neither of which has a mobile layout', () => {
    render(<MobileNav view="tonight" onNavigate={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Tonight' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Live' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Review/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Projects/i })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(2)
  })

  it('marks whichever screen is current with aria-current, not the other one', () => {
    const { rerender } = render(<MobileNav view="tonight" onNavigate={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Tonight' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Live' })).not.toHaveAttribute('aria-current')

    rerender(<MobileNav view="live" onNavigate={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Live' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Tonight' })).not.toHaveAttribute('aria-current')
  })

  it('calls onNavigate with the clicked target\'s view, not the currently active one', () => {
    const onNavigate = vi.fn()
    render(<MobileNav view="tonight" onNavigate={onNavigate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Live' }))
    expect(onNavigate).toHaveBeenCalledExactlyOnceWith('live')
  })

  // Regression guard for the design's own hard requirement (README.md:723-724)
  // — every interactive element on mobile is >= 44px tall. jsdom does not
  // compute real CSS layout (see LiveScreen.test.tsx's matching guard for the
  // telemetry grid), so this reads the actual rule from the CSS module
  // source rather than measuring a rendered element.
  it('gives each tab an explicit min-height of 44px', () => {
    const css = readFileSync(join(__dirname, 'MobileNav.module.css'), 'utf8')
    const tabRule = css.match(/\.tab\s*\{[^}]*\}/)?.[0] ?? ''
    expect(tabRule).toMatch(/min-height:\s*44px/)
  })
})
