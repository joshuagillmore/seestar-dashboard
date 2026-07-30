import type { Project, ProjectsCombinedEntry } from '../../api/schemas'

/**
 * One row for the Projects screen: projects_combined's totals/provenance for
 * a target_id, joined with list_projects' own record for the same id (see
 * docs/superpowers/specs/2026-07-28-slice-2-runnable-and-projects.md § Phase
 * 2). `store` is `null` for a target that exists only in the archive scan —
 * 18 of 33 targets today — rather than a Project with zeroed-out fields, so
 * "never tracked as a project" and "tracked with nothing set" stay
 * distinguishable by one null check instead of guessing from zeroed
 * goal/collected values.
 */
export interface MergedProject {
  targetId: string
  targetName: string
  totalMinutes: number
  storeMinutes: number
  archiveMinutes: number
  sources: ('store' | 'archive')[]
  store: Project | null
}

/**
 * Joins by target_id. Deliberately does NOT re-sort: projects_combined
 * already returns its entries total_minutes-descending (routes.py /
 * projects_union.py), and re-deriving that order here would be exactly the
 * kind of business logic the hand-back rule reserves for the server.
 */
export function mergeProjects(
  combined: ProjectsCombinedEntry[],
  listed: Project[],
): MergedProject[] {
  const byId = new Map(listed.map((project) => [project.target_id, project]))
  return combined.map((entry) => ({
    targetId: entry.target_id,
    targetName: entry.target_name,
    totalMinutes: entry.total_minutes,
    storeMinutes: entry.store_minutes,
    archiveMinutes: entry.archive_minutes,
    sources: entry.sources,
    store: byId.get(entry.target_id) ?? null,
  }))
}

export type ProjectTag = 'archive-only' | 'no-goal' | 'needs-data' | 'complete'

export interface StatusInfo {
  tag: ProjectTag
  label: string
}

/**
 * Every project in the live store has goal_minutes 0.0 today (the phase-2
 * spec's central finding), so 'needs-data' and 'complete' are unreachable
 * against real data — exercised only with synthetic MergedProject values in
 * projects.test.ts. That is deliberate: the day a real goal is set, this
 * function (and progressPct below) already know what to do with it, and the
 * screen degrades into the originally designed goal-progress view with no
 * further UI change.
 */
export function projectStatus(project: MergedProject): StatusInfo {
  if (!project.store) return { tag: 'archive-only', label: 'archive only' }
  if (project.store.goal_minutes <= 0) return { tag: 'no-goal', label: 'no goal' }
  return project.totalMinutes >= project.store.goal_minutes
    ? { tag: 'complete', label: 'complete' }
    : { tag: 'needs-data', label: 'needs data' }
}

/**
 * Null means "nothing to draw a track against" — no store record, or a store
 * record with goal_minutes <= 0 (every project today). The progress track
 * must not render at all in that case: see design/README.md § Screen 4 and
 * the phase-2 spec's "integration-led, not goal-led" ruling — this screen
 * shows hours collected as the lead fact precisely because there is
 * currently no goal for any project to show progress against.
 *
 * Measures against `totalMinutes` (store + archive union), not the store's
 * own `collected_minutes` alone: a goal is about real integration time, and
 * the union exists because the store alone undercounts it for the four
 * targets recorded in both places.
 */
export function progressPct(project: MergedProject): number | null {
  if (!project.store || project.store.goal_minutes <= 0) return null
  return Math.min(100, Math.round((project.totalMinutes / project.store.goal_minutes) * 100))
}

export const formatHours = (minutes: number): string => `${(minutes / 60).toFixed(1)} h`
export const formatMinutes = (minutes: number): string => `${minutes.toFixed(1)} min`

/**
 * "84.2 min store + 38.3 min archive" — the provenance split this screen
 * exists to make visible, rather than a single merged number with no
 * explanation (see the phase-2 spec's M31 example: 84.2 store + 38.3 archive,
 * neither source alone knowing the true ~122.5 min). Driven by `sources`
 * rather than a `> 0` check on the minute fields, so a source that
 * legitimately contributed 0.0 minutes still gets named rather than silently
 * dropped from the label.
 */
export function provenanceLabel(project: MergedProject): string {
  const parts: string[] = []
  if (project.sources.includes('store')) {
    parts.push(`${formatMinutes(project.storeMinutes)} store`)
  }
  if (project.sources.includes('archive')) {
    parts.push(`${formatMinutes(project.archiveMinutes)} archive`)
  }
  return parts.join(' + ')
}

export interface SessionsSummary {
  text: string
  /** Why the caller may want to attach an absent-value title — see
   * VerdictBanner's Stat component for the established convention of naming
   * which specific reason a value reads as a dash. */
  fwhmAbsent: boolean
}

/**
 * Null means the target has no store record at all — an archive-only
 * target's per-night detail genuinely does not exist (the archive scan
 * reports aggregate minutes only, not individual nights), so the caller
 * renders a distinct honest empty state rather than "0 sessions", which
 * would falsely imply a tracked project that simply hasn't logged anything.
 */
export function summarizeSessions(project: MergedProject): SessionsSummary | null {
  if (!project.store) return null
  const sessions = project.store.sessions
  if (sessions.length === 0) return { text: 'no sessions logged', fwhmAbsent: false }
  // The latest session by date_utc, not sessions[sessions.length - 1] — the
  // store has never been observed to return sessions out of chronological
  // order, but nothing guarantees it, and picking "last in the array" would
  // silently do the wrong thing the day it doesn't.
  const last = sessions.reduce((latest, session) =>
    session.date_utc > latest.date_utc ? session : latest,
  )
  const count = sessions.length
  const fwhmAbsent = last.median_fwhm === null
  const fwhmText = last.median_fwhm === null ? '—' : `${last.median_fwhm.toFixed(2)} px`
  return {
    text: `${count} session${count === 1 ? '' : 's'} · last ${last.date_utc.slice(0, 10)} · med FWHM ${fwhmText}`,
    fwhmAbsent,
  }
}
