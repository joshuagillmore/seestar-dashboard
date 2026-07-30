import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProjectsScreen } from './ProjectsScreen'
import { ListProjectsSchema, ProjectsCombinedSchema, SiteProfileSchema, type Health } from '../../api/schemas'
import { recordedListProjects, recordedProjectsCombined, recordedSite } from '../../test/fixtures'

const combined = ProjectsCombinedSchema.parse(recordedProjectsCombined())
const listed = ListProjectsSchema.parse(recordedListProjects())
const totalHoursText = `${(combined.totals.total_minutes / 60).toFixed(1)} h`

// site/health are shell-level data owned by App.tsx's useShellData() and
// passed in as props (see ProjectsScreenProps) — this screen fetches only
// projects_combined and list_projects itself.
const site = SiteProfileSchema.parse(recordedSite())
const notReplaying: Health = { ok: true, replay: false }

function stubApi(overrides: Record<string, unknown> = {}) {
  const bodies: Record<string, unknown> = {
    '/api/projects_combined': recordedProjectsCombined(),
    '/api/list_projects': recordedListProjects(),
    ...overrides,
  }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => ({ ok: true, status: 200, json: async () => bodies[url] })),
  )
}

async function renderLoaded(view: 'projects' = 'projects', onNavigate = vi.fn()) {
  render(<ProjectsScreen view={view} onNavigate={onNavigate} site={site} health={notReplaying} />)
  await waitFor(() => expect(screen.queryByTestId('projects-loading')).not.toBeInTheDocument())
  return onNavigate
}

afterEach(() => vi.unstubAllGlobals())

describe('ProjectsScreen', () => {
  it('shows a loading state first', () => {
    stubApi()
    render(<ProjectsScreen view="projects" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    expect(screen.getByTestId('projects-loading')).toBeInTheDocument()
  })

  it('renders one card per merged project, matching the real count and total hours', async () => {
    stubApi()
    await renderLoaded()
    const grid = screen.getByTestId('projects-grid')
    // 33 cards: 15 store-backed + 18 archive-only, read from the fixture,
    // not hardcoded — a join bug that dropped or duplicated a target would
    // fail this without anyone updating a magic number here. Scoped by
    // testid, not role=button: cards with a real numeric goal also render a
    // doubling-toggle button (see ProjectCard.tsx), so "every button" is no
    // longer one-per-card.
    expect(within(grid).getAllByTestId('project-card')).toHaveLength(combined.count)
    expect(
      screen.getByText(`${combined.count} projects · ${totalHoursText} collected`, { exact: false }),
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
    // M31 is one of the four overlapping targets — its table only ever shows
    // the store's 3 sessions, so the un-itemised-archive note must appear.
    expect(screen.getByText(/plus 38\.3 min from the archive, not itemised per night here/)).toBeInTheDocument()
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

  it('renders a progress track on every card — the sidecar now attaches a real goal per target', async () => {
    stubApi()
    await renderLoaded()
    // One track per card, real or empty-rail — see ProjectCard.tsx.
    expect(screen.getAllByTestId('progress-track')).toHaveLength(combined.count)
  })

  it('gives the real fixture its expected mix of goal states, not a single uniform one', async () => {
    stubApi()
    await renderLoaded()
    // 12 of the 15 store-backed projects are short of their suggested goal
    // (see projects.test.ts's exact-distribution test for the full split).
    expect(screen.getAllByText('needs data')).toHaveLength(12)
    expect(screen.getAllByText('complete').length).toBeGreaterThanOrEqual(1)
    // IC 405 — archive-only, and its photometry is flagged unreliable rather
    // than blank (see CLAUDE.md's honesty requirements for this exact case).
    expect(screen.getByText('photometry not credible')).toBeInTheDocument()
  })

  it('shows an honest note that goals are catalogue-suggested, not user-set, instead of a recommend_projects shortfall line', async () => {
    stubApi()
    await renderLoaded()
    expect(screen.getByText(/catalogue-suggested, not user-set/)).toBeInTheDocument()
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

  it('renders the site profile passed in from the shared app shell', async () => {
    // Regression test for the "site block blanks on navigation" bug: this
    // screen no longer fetches get_site_profile itself, so the ONLY way this
    // can pass is if the `site` prop is actually threaded to Sidebar/TopBar.
    stubApi()
    await renderLoaded()
    // Renders in two places (Sidebar's site block, TopBar's facts row), so
    // scope by element type/testid rather than a bare getByText.
    expect(screen.getByText('Example Observatory (scope GPS)', { selector: 'div' })).toBeInTheDocument()
    expect(screen.getByTestId('fact-site')).toHaveTextContent('Example Observatory (scope GPS)')
  })

  it('renders gracefully when site/health have not arrived yet (null props)', async () => {
    stubApi()
    render(<ProjectsScreen view="projects" onNavigate={vi.fn()} site={null} health={null} />)
    await waitFor(() => expect(screen.queryByTestId('projects-loading')).not.toBeInTheDocument())
    expect(screen.queryByText('Example Observatory (scope GPS)')).not.toBeInTheDocument()
    expect(
      screen.getByText(`${combined.count} projects · ${totalHoursText} collected`, { exact: false }),
    ).toBeInTheDocument()
  })

  it('shows an error banner when the sidecar is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    render(<ProjectsScreen view="projects" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    expect(screen.getByRole('alert')).toHaveTextContent(/unreachable/i)
  })
})
