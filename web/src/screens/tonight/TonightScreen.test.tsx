import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TonightScreen } from './TonightScreen'
import { PlanTargetsSchema } from '../../api/schemas'
import { recordedConditions, recordedPlan, recordedSite } from '../../test/fixtures'

/** One card per ranked target — read from the fixture, not hardcoded. */
const planTargetCount = PlanTargetsSchema.parse(recordedPlan()).targets.length

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
    render(<TonightScreen />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent(/unreachable/i)
  })
})
