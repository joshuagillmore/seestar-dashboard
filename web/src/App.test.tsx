import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import {
  recordedConditions,
  recordedListProjects,
  recordedPlan,
  recordedProjectsCombined,
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
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => bodies[url] })),
  )
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
})
