import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectsScreen } from './ProjectsScreen'
import { ListProjectsSchema, ProjectsCombinedSchema } from '../../api/schemas'
import { recordedListProjects, recordedProjectsCombined } from '../../test/fixtures'

const combined = ProjectsCombinedSchema.parse(recordedProjectsCombined())
const listed = ListProjectsSchema.parse(recordedListProjects())
const totalHoursText = `${(combined.totals.total_minutes / 60).toFixed(1)} h`

function stubApi(overrides: Record<string, unknown> = {}) {
  const bodies: Record<string, unknown> = {
    '/api/projects_combined': recordedProjectsCombined(),
    '/api/list_projects': recordedListProjects(),
    '/api/health': { ok: true, replay: false },
    ...overrides,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => bodies[url] })),
  )
}

async function renderLoaded(view: 'projects' = 'projects', onNavigate = vi.fn()) {
  render(<ProjectsScreen view={view} onNavigate={onNavigate} />)
  await waitFor(() => expect(screen.queryByTestId('projects-loading')).not.toBeInTheDocument())
  return onNavigate
}

afterEach(() => vi.unstubAllGlobals())

describe('ProjectsScreen', () => {
  it('shows a loading state first', () => {
    stubApi()
    render(<ProjectsScreen view="projects" onNavigate={vi.fn()} />)
    expect(screen.getByTestId('projects-loading')).toBeInTheDocument()
  })

  it('renders one card per merged project, matching the real count and total hours', async () => {
    stubApi()
    await renderLoaded()
    const grid = screen.getByTestId('projects-grid')
    // 33 cards: 15 store-backed + 18 archive-only, read from the fixture,
    // not hardcoded — a join bug that dropped or duplicated a target would
    // fail this without anyone updating a magic number here.
    expect(within(grid).getAllByRole('button')).toHaveLength(combined.count)
    expect(
      screen.getByText(`${combined.count} projects · ${totalHoursText} collected`),
    ).toBeInTheDocument()
  })

  it('defaults the session history to the highest-hours project (IC405, archive-only)', async () => {
    stubApi()
    await renderLoaded()
    // combined.projects is sorted total_minutes-descending server-side —
    // its first entry is the honest default selection.
    const top = combined.projects[0]
    expect(top.target_id).toBe('IC405')
    expect(screen.getByText(`${top.target_id} · SESSION HISTORY — list_projects`)).toBeInTheDocument()
    expect(screen.getByText(/appears only in the archive scan/)).toBeInTheDocument()
  })

  it('re-scopes the session history when a different card is clicked', async () => {
    stubApi()
    await renderLoaded()

    const m31Sessions = listed.projects.find((p) => p.target_id === 'M31')?.sessions ?? []
    expect(m31Sessions.length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /M31/ }))

    expect(screen.getByText('M31 · SESSION HISTORY — list_projects')).toBeInTheDocument()
    expect(screen.queryByText(/appears only in the archive scan/)).not.toBeInTheDocument()
    // The real M31 record has 3 sessions in the store — 1 header row + 3 data rows.
    expect(screen.getAllByRole('row')).toHaveLength(1 + m31Sessions.length)
  })

  it('shows the provenance split on an overlapping target rather than only its merged total', async () => {
    stubApi()
    await renderLoaded()
    // Recorded: M31 is 84.2 min store + 38.3 min archive (see slice-2-backlog.md).
    expect(screen.getByText('84.2 min store + 38.3 min archive')).toBeInTheDocument()
  })

  it('renders the "Unknown" archive target literally, not dropped or renamed', async () => {
    stubApi()
    await renderLoaded()
    expect(screen.getByRole('button', { name: /^Unknown/ })).toBeInTheDocument()
  })

  it('renders no progress track anywhere — every project has goal_minutes 0 today', async () => {
    stubApi()
    await renderLoaded()
    expect(screen.queryAllByTestId('progress-track')).toHaveLength(0)
  })

  it('shows an honest note about goals instead of a recommend_projects shortfall line', async () => {
    stubApi()
    await renderLoaded()
    expect(screen.getByText(/no goals set/)).toBeInTheDocument()
    expect(screen.queryByText(/short of goal/)).not.toBeInTheDocument()
  })

  it('passes the real total hours to the sidebar as the Projects nav headline', async () => {
    stubApi()
    await renderLoaded()
    expect(screen.getByRole('button', { name: /Projects/ })).toHaveTextContent(totalHoursText)
  })

  it('marks Projects as the active nav item and forwards clicks on other items', async () => {
    stubApi()
    const onNavigate = await renderLoaded('projects', vi.fn())
    expect(screen.getByRole('button', { name: /Projects/ })).toHaveAttribute('aria-current', 'page')
    fireEvent.click(screen.getByRole('button', { name: /Tonight/ }))
    expect(onNavigate).toHaveBeenCalledWith('tonight')
  })

  it('shows an error banner when the sidecar is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    render(<ProjectsScreen view="projects" onNavigate={vi.fn()} />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent(/unreachable/i)
  })
})
