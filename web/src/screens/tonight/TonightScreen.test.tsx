import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TonightScreen } from './TonightScreen'
import { recordedConditions, recordedPlan, recordedSite } from '../../test/fixtures'

function stubApi(overrides: Record<string, unknown> = {}) {
  const bodies: Record<string, unknown> = {
    '/api/assess_conditions': recordedConditions(),
    '/api/plan_targets?limit=3': recordedPlan(),
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
    render(<TonightScreen />)
    expect(screen.getByTestId('tonight-loading')).toBeInTheDocument()
  })

  it('renders the verdict, timeline and cards once loaded', async () => {
    stubApi()
    render(<TonightScreen />)
    // Assembled together, "NO-GO" appears twice: the sidebar's nav meta
    // (a <span>) and the verdict banner's headline word (a <div>). Scoped by
    // tag to target the banner specifically, rather than asserting a single
    // match that only holds when components are tested in isolation.
    await waitFor(() =>
      expect(screen.getByText('NO-GO', { selector: 'div' })).toBeInTheDocument(),
    )
    // M76 legitimately renders twice once assembled — the timeline lane label
    // and the plan card's id — so assert presence, not a single match.
    expect(screen.getAllByText('M76').length).toBeGreaterThan(0)
    expect(screen.getByText(/sweet-band windows/i)).toBeInTheDocument()
  })

  it('shows an error banner when the sidecar is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    render(<TonightScreen />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent(/unreachable/i)
  })
})
