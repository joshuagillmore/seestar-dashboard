import { useEffect, useState } from 'react'
import { fetchProjects, fetchProjectsCombined, fetchQaTargets,
  fetchRecommendProjects } from '../../api/client'
import type {
  Health,
  ListProjects,
  ProjectsCombined,
  RecommendProjects,
  SiteProfile,
  QaTargets,
} from '../../api/schemas'
import { AppShell } from '../../shell/AppShell'
import { Sidebar } from '../../shell/Sidebar'
import { TopBar } from '../../shell/TopBar'
import type { View } from '../../shell/view'
import { ProjectCard } from './ProjectCard'
import { setPendingReviewTarget } from '../review/pendingTarget'
import { SessionHistory } from './SessionHistory'
import { formatHours, mergeProjects, projectStatus } from './projects'
import { readSelectedProjectId, writeSelectedProjectId } from './selection'
import styles from './ProjectsScreen.module.css'

interface Data {
  combined: ProjectsCombined
  listed: ListProjects
  /** `null` covers both "the fetch failed" and "the tool answered but named
   * nothing" — neither is worth a separate loading/error state of its own
   * for what's a best-effort header line; see fetchRecommendProjects's own
   * `.catch(() => null)` below. */
  recommended: RecommendProjects | null
  /** Per-target QA verdict mixes, for the quality bars. `null` when the
   * listing could not be fetched; a target simply missing from it (or
   * carrying no `verdicts`) means "never analysed", which renders no bar
   * rather than an empty one. */
  qa: QaTargets | null
}

/**
 * `recommend_projects` is allowlisted and live (routes.py:171) but, verified
 * against the recorded fixture, currently returns `list_projects`'s own
 * stored order truncated to `limit` — byte-identical, not reordered — because
 * every real project has `goal_minutes: 0` (see ProjectsScreen's own comment
 * below and the phase-2 spec). There is no shortfall figure anywhere in the
 * payload, so the design's "N h short of goal" clause (README.md:649) has no
 * honest source yet: computing one from this screen's own suggested-goal
 * model (projects_combined's `goal` field) would attribute a number to a pick
 * that wasn't actually made using it — two independent computations that
 * happen to share a target. Restoring `set_project_goal` (a write tool,
 * permanently outside the allowlist) is what would make this a scored
 * recommendation.
 */
const RECOMMEND_TITLE =
  "recommend_projects is live, but every real project's goal_minutes is 0 in the store, so it " +
  "currently returns list_projects's own stored order rather than a scored shortfall ranking — " +
  'there is no "N h short of goal" figure to show yet. See docs/design-review-2026-07-30.md item B5.'

export interface ProjectsScreenProps {
  view: View
  onNavigate: (view: View) => void
  /** Shell-level data owned by App.tsx (useShellData) — fetched once, shared
   * across screens, so it survives a view switch instead of blanking and
   * re-fetching. See useShellData's docstring. */
  site: SiteProfile | null
  health: Health | null
}

/**
 * Integration-led per the phase-2 ruling (docs/superpowers/specs/2026-07-28-
 * slice-2-runnable-and-projects.md): every real project has goal_minutes 0,
 * so hours collected leads and cards sort by most time invested, rather than
 * by shortfall against a goal nothing has. Only two endpoints are fetched
 * HERE — projects_combined (union + provenance) and list_projects (goals,
 * status, session history) — joined client-side by target_id in
 * mergeProjects(). site/health come from the shared useShellData() in
 * App.tsx, not a third fetch of this screen's own.
 */
export function ProjectsScreen({ view, onNavigate, site, health }: ProjectsScreenProps) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Read once at mount from localStorage (see selection.ts) so a round trip
  // to another screen and back — App.tsx unmounts this screen entirely —
  // restores the same card instead of resetting to the default.
  const [selectedId, setSelectedId] = useState<string | null>(() => readSelectedProjectId())

  const selectProject = (targetId: string) => {
    setSelectedId(targetId)
    writeSelectedProjectId(targetId)
  }

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetchProjectsCombined(),
      fetchProjects(),
      // Best-effort: a hiccup here degrades to an honest absent state in the
      // header (see RECOMMEND_TITLE), not a failure of the whole screen —
      // this line is a bonus, not load-bearing data the rest of the screen
      // depends on.
      fetchRecommendProjects(1).catch(() => null),
      // Also best-effort, and for the same reason: the quality bars are an
      // addition to each card, not the card. A failure here (or an archive
      // with nothing analysed yet) means no bars, never a broken grid.
      fetchQaTargets().catch(() => null),
    ])
      .then(([combined, listed, recommended, qa]) => {
        if (!cancelled) setData({ combined, listed, recommended, qa })
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const merged = data ? mergeProjects(data.combined.projects, data.listed.projects) : []
  // Highest hours-collected first, since that's projects_combined's own sort
  // order and mergeProjects preserves it — the natural default selection for
  // an integration-led screen.
  const selected = merged.find((p) => p.targetId === selectedId) ?? merged[0] ?? null
  const totalHours = data ? formatHours(data.combined.totals.total_minutes) : null
  // Aggregate headline only — not doubled: a per-card view toggle shouldn't
  // change what the header claims about the fleet as a whole.
  const needsDataCount = merged.filter((p) => projectStatus(p, false).tag === 'needs-data').length

  const topRecommendation = data?.recommended?.projects[0] ?? null
  const recommendText = topRecommendation
    ? `recommend_projects: ${topRecommendation.target_name} first`
    : 'recommend_projects: no recommendation available'

  return (
    <AppShell
      topBar={<TopBar site={site} replay={health?.replay ?? false} />}
      sidebar={
        <Sidebar
          site={site}
          verdict={null}
          gpsWarning={null}
          view={view}
          onNavigate={onNavigate}
          projectsHeadline={totalHours}
          projectsNeedsData={data ? needsDataCount : null}
        />
      }
    >
      <div className={styles.screen}>
        <div className={styles.header}>
          <div>
            <div className={styles.eyebrow}>list_projects · multi-night integration</div>
            <h1 className={styles.heading}>
              {data
                ? `${data.combined.count} projects · ${totalHours} collected` +
                  (needsDataCount > 0 ? ` · ${needsDataCount} need data` : '')
                : 'Projects'}
            </h1>
          </div>
          {data && (
            <div className={styles.headerRight}>
              <div className={styles.recommend} title={topRecommendation ? RECOMMEND_TITLE : undefined}>
                {recommendText}
              </div>
              <div className={styles.source}>
                {formatHours(data.combined.totals.store_minutes)} store ·{' '}
                {formatHours(data.combined.totals.archive_minutes)} archive · goals are
                catalogue-suggested, not user-set
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        {!data && !error && (
          <div data-testid="projects-loading">
            <div className={styles.skeleton} />
          </div>
        )}

        {data && (
          merged.length > 0 ? (
            <>
              <div className={styles.grid} data-testid="projects-grid">
                {merged.map((project) => (
                  <ProjectCard
                    verdicts={
                      data.qa?.targets.find((q) => q.target_id === project.targetId)?.verdicts
                    }
                    onOpenQa={() => {
                      setPendingReviewTarget(project.targetId)
                      onNavigate('review')
                    }}
                    key={project.targetId}
                    project={project}
                    selected={project.targetId === selected?.targetId}
                    onSelect={() => selectProject(project.targetId)}
                  />
                ))}
              </div>
              {selected && <SessionHistory project={selected} />}
            </>
          ) : (
            <div className={styles.empty}>
              No projects yet — nothing in the store and nothing in the archive scan.
            </div>
          )
        )}
      </div>
    </AppShell>
  )
}
