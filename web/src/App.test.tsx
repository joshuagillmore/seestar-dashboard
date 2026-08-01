import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  recordedConditions,
  recordedListProjects,
  recordedPlan,
  recordedProjectsCombined,
  recordedRecommendProjects,
  recordedSite,
} from './test/fixtures'

function stubApi() {
  const bodies: Record<string, unknown> = {
    '/api/assess_conditions': recordedConditions(),
    '/api/plan_targets?limit=12': recordedPlan(),
    '/api/get_site_profile': recordedSite(),
    '/api/health': { ok: true, replay: false },
    '/api/projects_combined': recordedProjectsCombined(),
    '/api/list_projects': recordedListProjects(),
    '/api/recommend_projects?limit=1': recordedRecommendProjects(),
  }
  const fetchMock = vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => bodies[url] }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('App', () => {
  it('starts on the Tonight screen', async () => {
    stubApi()
    render(<App />)
    await waitFor(() => expect(screen.getByText(/Observing planner/)).toBeInTheDocument())
    expect(screen.queryByText(/list_projects · multi-night integration/)).not.toBeInTheDocument()
  })

  it('switches to the Projects screen when its nav item is clicked, and back to Tonight', async () => {
    stubApi()
    render(<App />)
    await waitFor(() => expect(screen.getByText(/Observing planner/)).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Projects/ }))
    await waitFor(() =>
      expect(screen.getByText(/list_projects · multi-night integration/)).toBeInTheDocument(),
    )
    // Actually a different screen, not the same one with new text bolted on.
    expect(screen.queryByText(/Observing planner/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Tonight/ }))
    await waitFor(() => expect(screen.getByText(/Observing planner/)).toBeInTheDocument())
    expect(screen.queryByText(/list_projects · multi-night integration/)).not.toBeInTheDocument()
  })

  it('keeps the site profile and replay badge visible across a view switch, fetching each only once', async () => {
    // Regression test: site/health used to be fetched inside whichever
    // screen was mounted, so switching screens tore the fetch down and
    // re-ran it — blanking the sidebar's site block and the top bar's site
    // pill for a beat on every navigation. Both are now owned by App.tsx's
    // useShellData() instead.
    const fetchMock = stubApi()
    render(<App />)
    await waitFor(() => expect(screen.getByText(/Observing planner/)).toBeInTheDocument())
    expect(screen.getByText('Example Observatory', { selector: 'div' })).toBeInTheDocument()
    expect(screen.getByTestId('fact-site')).toHaveTextContent('Example Observatory')

    fireEvent.click(screen.getByRole('button', { name: /Projects/ }))
    await waitFor(() =>
      expect(screen.getByText(/list_projects · multi-night integration/)).toBeInTheDocument(),
    )
    // Never disappears, not "reappears after a refetch" — no waitFor here.
    expect(screen.getByText('Example Observatory', { selector: 'div' })).toBeInTheDocument()
    expect(screen.getByTestId('fact-site')).toHaveTextContent('Example Observatory')

    fireEvent.click(screen.getByRole('button', { name: /Tonight/ }))
    await waitFor(() => expect(screen.getByText(/Observing planner/)).toBeInTheDocument())
    expect(screen.getByText('Example Observatory', { selector: 'div' })).toBeInTheDocument()

    const siteCalls = fetchMock.mock.calls.filter(([url]) => url === '/api/get_site_profile')
    const healthCalls = fetchMock.mock.calls.filter(([url]) => url === '/api/health')
    expect(siteCalls).toHaveLength(1)
    expect(healthCalls).toHaveLength(1)
  })
})
