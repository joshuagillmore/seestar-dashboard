import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectsScreen } from './ProjectsScreen'
import { ListProjectsSchema, ProjectsCombinedSchema, SiteProfileSchema, type Health } from '../../api/schemas'
import {
  recordedListProjects,
  recordedProjectsCombined,
  recordedRecommendProjects,
  recordedSite,
} from '../../test/fixtures'

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
    // fetchRecommendProjects(1) always requests limit=1 — see client.ts.
    '/api/recommend_projects?limit=1': recordedRecommendProjects(),
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

// selection.ts persists the selected card in localStorage (see item 5 of
// docs/design-review-2026-07-30.md) — real localStorage, not a mock, so it
// must be cleared between tests to avoid one test's click leaking into the
// next test's "default selection" assumption.
beforeEach(() => localStorage.clear())
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

  it('defaults the session history to the highest-hours project (IC405, archive-only), now itemised by night rather than an aggregate-only empty state', async () => {
    stubApi()
    await renderLoaded()
    // combined.projects is sorted total_minutes-descending server-side —
    // its first entry is the honest default selection.
    const top = combined.projects[0]
    expect(top.target_id).toBe('IC405')
    expect(top.nights.length).toBeGreaterThan(0) // exercising the real itemised case, not the empty one
    expect(screen.getByText(`${top.target_id} · SESSION HISTORY — log_session_result`)).toBeInTheDocument()
    // The old aggregate-only message is gone now that nights are available —
    // 1 header row + one row per real archive night.
    expect(screen.queryByText(/appears only in the archive scan/)).not.toBeInTheDocument()
    expect(screen.getAllByRole('row')).toHaveLength(1 + top.nights.length)
    expect(screen.getAllByText('archive').length).toBe(top.nights.length)
  })

  it('re-scopes the session history when a different card is clicked, itemising both the store sessions and the archive nights', async () => {
    stubApi()
    await renderLoaded()

    const m31Sessions = listed.projects.find((p) => p.target_id === 'M31')?.sessions ?? []
    const m31Nights = combined.projects.find((p) => p.target_id === 'M31')?.nights ?? []
    expect(m31Sessions.length).toBeGreaterThan(0)
    // M31 is one of the targets recorded in both sources — this is the exact
    // case the M31-table-doesn't-close gap was about, so the fixture must
    // actually exercise it rather than only the single-source cases above.
    expect(m31Nights.length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /M31/ }))

    expect(screen.getByText('M31 · SESSION HISTORY — log_session_result')).toBeInTheDocument()
    expect(screen.queryByText(/appears only in the archive scan/)).not.toBeInTheDocument()
    // 1 header + 3 store-session rows + 1 archive-night row — the table's own
    // rows now account for every one of M31's 122.5 min, not just the 84.2
    // min the store alone knows about.
    const rows = screen.getAllByRole('row')
    expect(rows).toHaveLength(1 + m31Sessions.length + m31Nights.length)
    // The un-itemised-archive stopgap note is gone; the real night is a row.
    expect(screen.queryByText(/not itemised per night here/)).not.toBeInTheDocument()
    const archiveRow = rows[rows.length - 1]
    expect(within(archiveRow).getByText(m31Nights[0].night, { exact: false })).toBeInTheDocument()
    expect(within(archiveRow).getByText('archive')).toBeInTheDocument()
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
    // Across all 33 merged projects, completion is driven by the goal math
    // alone now — archive-only targets are no longer excluded from these
    // counts by a separate provenance tag (see projects.test.ts's
    // exact-distribution test for the full split, and item 3 of
    // docs/design-review-2026-07-30.md for why the counts changed from the
    // old store-backed-only 12/2/1).
    expect(screen.getAllByText('needs data')).toHaveLength(22)
    expect(screen.getAllByText('complete')).toHaveLength(3)
    // IC 405 — archive-only, and its photometry is flagged unreliable rather
    // than blank (see CLAUDE.md's honesty requirements for this exact case).
    expect(screen.getByText('photometry not credible')).toBeInTheDocument()
  })

  it('restores the recommend_projects header line with the tool\'s own top pick, alongside (not instead of) the provenance note', async () => {
    stubApi()
    await renderLoaded()
    // Real fixture: recommend_projects's first entry is M101 / Pinwheel Galaxy.
    expect(screen.getByText('recommend_projects: Pinwheel Galaxy first')).toBeInTheDocument()
    // No fabricated shortfall figure — see RECOMMEND_TITLE's own honesty
    // caveat (recommend_projects has no shortfall figure to source one from).
    expect(screen.queryByText(/short of goal/)).not.toBeInTheDocument()
    // The provenance note is kept, not dropped, just moved to a quieter spot.
    expect(screen.getByText(/catalogue-suggested, not user-set/)).toBeInTheDocument()
  })

  it('shows an honest absent state, not a blank gap, when recommend_projects names nothing', async () => {
    stubApi({ '/api/recommend_projects?limit=1': { ok: true, projects: [], count: 0 } })
    await renderLoaded()
    expect(screen.getByText('recommend_projects: no recommendation available')).toBeInTheDocument()
  })

  it('degrades to the same honest absent state, without blocking the rest of the screen, when recommend_projects itself fails', async () => {
    const bodies: Record<string, unknown> = {
      '/api/projects_combined': recordedProjectsCombined(),
      '/api/list_projects': recordedListProjects(),
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/api/recommend_projects?limit=1') throw new Error('ECONNREFUSED')
        return { ok: true, status: 200, json: async () => bodies[url] }
      }),
    )
    await renderLoaded()
    expect(screen.getByText('recommend_projects: no recommendation available')).toBeInTheDocument()
    // The rest of the screen is unaffected — this fetch is a bonus, not
    // load-bearing data (see ProjectsScreen.tsx's own comment on the Promise.all).
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      screen.getByText(`${combined.count} projects · ${totalHoursText} collected`, { exact: false }),
    ).toBeInTheDocument()
  })

  it('passes the real total hours to the sidebar as the Projects nav headline', async () => {
    stubApi()
    await renderLoaded()
    expect(screen.getByRole('button', { name: /Projects/ })).toHaveTextContent(totalHoursText)
  })

  it('threads the real needsDataCount through to the Projects nav dot instead of leaving it idle', async () => {
    stubApi()
    await renderLoaded()
    // Nav rows in order: Tonight, Live, Review, Projects — dots[3] is Projects.
    // The real fixture has 22 projects needing data (see the goal-states test
    // above), so this must read 'marginal', not 'idle'.
    const dots = screen.getAllByTestId('dot')
    expect(dots[3]).toHaveAttribute('data-dot', 'marginal')
  })

  it('persists the selected project across a remount, instead of resetting to the highest-hours default', async () => {
    stubApi()
    const { unmount } = render(
      <ProjectsScreen view="projects" onNavigate={vi.fn()} site={site} health={notReplaying} />,
    )
    await waitFor(() => expect(screen.queryByTestId('projects-loading')).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /M31/ }))
    expect(screen.getByText('M31 · SESSION HISTORY — log_session_result')).toBeInTheDocument()

    // Simulates App.tsx unmounting this screen on a navigation away and back
    // (view.ts / App.tsx render either TonightScreen or ProjectsScreen, never
    // both — see selection.ts's doc comment).
    unmount()
    render(<ProjectsScreen view="projects" onNavigate={vi.fn()} site={site} health={notReplaying} />)
    await waitFor(() => expect(screen.queryByTestId('projects-loading')).not.toBeInTheDocument())

    // M31 is selected again by default — not IC405 (the highest-hours card).
    expect(screen.getByText('M31 · SESSION HISTORY — log_session_result')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /M31/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('falls back to the default selection, rather than selecting nothing, when the persisted id no longer exists in the fetched data', async () => {
    localStorage.setItem('seestar-dashboard:selected-project:v1', JSON.stringify('NO-SUCH-TARGET'))
    stubApi()
    await renderLoaded()
    // Falls back to IC405, the highest-hours default — not a blank selection.
    expect(screen.getByText('IC405 · SESSION HISTORY — log_session_result')).toBeInTheDocument()
  })

  it('degrades to the default selection, without crashing, when the persisted value is corrupt junk', async () => {
    localStorage.setItem('seestar-dashboard:selected-project:v1', '{not valid json')
    stubApi()
    await renderLoaded()
    expect(screen.getByText('IC405 · SESSION HISTORY — log_session_result')).toBeInTheDocument()
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
    expect(screen.getByText('Example Observatory', { selector: 'div' })).toBeInTheDocument()
    expect(screen.getByTestId('fact-site')).toHaveTextContent('Example Observatory')
  })

  it('renders gracefully when site/health have not arrived yet (null props)', async () => {
    stubApi()
    render(<ProjectsScreen view="projects" onNavigate={vi.fn()} site={null} health={null} />)
    await waitFor(() => expect(screen.queryByTestId('projects-loading')).not.toBeInTheDocument())
    expect(screen.queryByText('Example Observatory')).not.toBeInTheDocument()
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
