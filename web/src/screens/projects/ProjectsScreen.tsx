import { useEffect, useState } from 'react'
import { fetchHealth, fetchProjects, fetchProjectsCombined } from '../../api/client'
import type { Health, ListProjects, ProjectsCombined } from '../../api/schemas'
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
  health: Health
}

export interface ProjectsScreenProps {
  view: View
  onNavigate: (view: View) => void
}

/**
 * Integration-led per the phase-2 ruling (docs/superpowers/specs/2026-07-28-
 * slice-2-runnable-and-projects.md): every real project has goal_minutes 0,
 * so hours collected leads and cards sort by most time invested, rather than
 * by shortfall against a goal nothing has. Only two endpoints are called —
 * projects_combined (union + provenance) and list_projects (goals, status,
 * session history) — joined client-side by target_id in mergeProjects().
 *
 * Deliberately does NOT fetch get_site_profile: the site/GPS block in the
 * sidebar is therefore absent while this screen is mounted (Sidebar already
 * renders that gracefully for a null site — see its own tests). Fetching it
 * here just to keep that block populated would be a third endpoint beyond
 * what this slice's data contract calls for, for a screen that has nothing
 * to do with site geometry.
 */
export function ProjectsScreen({ view, onNavigate }: ProjectsScreenProps) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchProjectsCombined(), fetchProjects(), fetchHealth()])
      .then(([combined, listed, health]) => {
        if (!cancelled) setData({ combined, listed, health })
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
      topBar={<TopBar site={null} replay={data?.health.replay ?? false} />}
      sidebar={
        <Sidebar
          site={null}
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
