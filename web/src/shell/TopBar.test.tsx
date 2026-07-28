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

  it('never shows a healthy connection dot before telemetry is routed', () => {
    const { container } = render(<TopBar site={site} replay={false} />)
    expect(container.querySelectorAll('[data-dot="pass"]')).toHaveLength(0)
    expect(screen.getByText(/slice 3/)).toBeInTheDocument()
  })

  it('surfaces replay mode so fixtures are never mistaken for live data', () => {
    render(<TopBar site={site} replay />)
    expect(screen.getByText(/fixtures/i)).toBeInTheDocument()
  })
})
