import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MobileNav } from './MobileNav'
import { VIEWS } from './view'

describe('MobileNav', () => {
  // This replaced a test that asserted the opposite — "renders exactly the two
  // mobile screens, no Review, no Projects" — which was true when written and
  // then quietly cemented a bug: MobileReviewView and MobileProjectsView were
  // built later and had no way in, on the only device they exist for. The old
  // assertion would have stayed green forever. Enumerating VIEWS instead means
  // a new view fails here until the nav can reach it.
  it('can reach every view the app has, not a hardcoded subset', () => {
    const onNavigate = vi.fn()
    render(<MobileNav view="tonight" onNavigate={onNavigate} />)

    const tabs = screen.getAllByRole('button')
    expect(tabs).toHaveLength(VIEWS.length)

    tabs.forEach((tab) => fireEvent.click(tab))
    expect(new Set(onNavigate.mock.calls.map((c) => c[0]))).toEqual(new Set(VIEWS))
  })

  it('labels every tab with something short enough not to wrap at 393px', () => {
    // Four tabs share ~361px of usable width (393 minus the design's 16px
    // side padding), so ~84px each. Long forms like "Review & QA" clip.
    render(<MobileNav view="tonight" onNavigate={vi.fn()} />)
    for (const tab of screen.getAllByRole('button')) {
      expect(tab.textContent!.length).toBeLessThanOrEqual(9)
    }
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
