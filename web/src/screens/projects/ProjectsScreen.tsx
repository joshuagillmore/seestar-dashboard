import { useEffect, useState } from 'react'
import { fetchProjects, fetchProjectsCombined } from '../../api/client'
import type { Health, ListProjects, ProjectsCombined, SiteProfile } from '../../api/schemas'
import { AppShell } from '../../shell/AppShell'
import { Sidebar } from '../../shell/Sidebar'
import { TopBar } from '../../shell/TopBar'
import type { View } from '../../shell/view'
import { ProjectCard } from './ProjectCard'
import { SessionHistory } from './SessionHistory'
import { formatHours, mergeProjects } from './projects'
import styles from './ProjectsScreen.module.css'

interface Data {
  combined: ProjectsCombined
  listed: ListProjects
}

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
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchProjectsCombined(), fetchProjects()])
      .then(([combined, listed]) => {
        if (!cancelled) setData({ combined, listed })
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
        />
      }
    >
      <div className={styles.screen}>
        <div className={styles.header}>
          <div>
            <div className={styles.eyebrow}>list_projects · multi-night integration</div>
            <h1 className={styles.heading}>
              {data ? `${data.combined.count} projects · ${totalHours} collected` : 'Projects'}
            </h1>
          </div>
          {data && (
            <div className={styles.source}>
              {formatHours(data.combined.totals.store_minutes)} store ·{' '}
              {formatHours(data.combined.totals.archive_minutes)} archive · no goals set
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
                    key={project.targetId}
                    project={project}
                    selected={project.targetId === selected?.targetId}
                    onSelect={() => setSelectedId(project.targetId)}
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
