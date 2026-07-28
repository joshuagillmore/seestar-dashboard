import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TopBar } from './TopBar'
import { SiteProfileSchema } from '../api/schemas'
import { recordedSite } from '../test/fixtures'

const site = SiteProfileSchema.parse(recordedSite())

describe('TopBar', () => {
  it('shows the wordmark and server version', () => {
    render(<TopBar site={site} replay={false} />)
    expect(screen.getByText('seestar')).toBeInTheDocument()
    expect(screen.getByText('mcp 0.1.0')).toBeInTheDocument()
  })

  it('never shows fabricated connection telemetry', () => {
    render(<TopBar site={site} replay={false} />)
    // Assert on the design's literal pill copy, which is what a regression
    // would actually reintroduce. An earlier version of this test queried
    // [data-dot="pass"] — an attribute nothing in the codebase sets — so it
    // passed vacuously and would have missed a dot added any other way.
    expect(screen.queryByText(/bridge/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/fw \d/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/alt-az/i)).not.toBeInTheDocument()
    expect(screen.getByText(/slice 3/)).toBeInTheDocument()
  })

  it('renders the site name and Bortle from the profile', () => {
    // The facts row is the only branch with property access; a typo'd field
    // name would otherwise render blank with every test still green.
    render(<TopBar site={site} replay={false} />)
    expect(screen.getByTestId('fact-site')).toHaveTextContent('Example Observatory (scope GPS)')
    expect(screen.getByTestId('fact-bortle')).toHaveTextContent('8')
  })

  it('surfaces replay mode so fixtures are never mistaken for live data', () => {
    render(<TopBar site={site} replay />)
    expect(screen.getByText(/fixtures/i)).toBeInTheDocument()
  })

  it('renders while the site profile is still loading', () => {
    // Task 13 mounts the shell before data arrives, so site is null on first
    // paint. The bar must render its chrome rather than crash or blank out.
    render(<TopBar site={null} replay={false} />)
    expect(screen.getByText('seestar')).toBeInTheDocument()
    expect(screen.getByText(/slice 3/)).toBeInTheDocument()
  })
})
