import { describeGoal, goalMet, goalProgressPct } from '../../api/integrationGoal'
import type { ArchiveNight, IntegrationGoal, Project, ProjectsCombinedEntry, TargetImage } from '../../api/schemas'

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
  /** The sidecar's suggested integration-time goal for this target (see
   * integrationGoal.ts / integration_goal.py's module docstring) — computed
   * independently of whether the target has a `store` record at all, so an
   * archive-only target (e.g. IC 405, never logged as a project) still gets
   * an honest goal state instead of one gated on `store` existing. */
  goal: IntegrationGoal | null
  /** The cover image for this target's card — the user's own capture, a
   * sky-survey cutout, or `null` when neither resolves. Normalized from
   * `ProjectsCombinedEntry.image`'s `undefined | null` (the field hasn't
   * shipped on every payload yet) to a plain `null`, so ProjectCard has one
   * absent case to handle, not two. See TargetImageSchema and TargetThumb,
   * which actually renders it. */
  image: TargetImage | null
  /** The archive's own per-night detail (see `ArchiveNightSchema`), already
   * filtered server-side against the store's own sessions — see
   * `ProjectsCombinedEntrySchema`'s doc comment for the invariant this
   * carries (`sum(nights.minutes) === archiveMinutes`). Always an array,
   * mirroring the schema: `[]` for a store-only target, since its detail is
   * already fully available as `store.sessions`. SessionHistory.tsx renders
   * these alongside `store.sessions` so the table's total can finally match
   * `totalMinutes` for a target recorded in both sources. */
  nights: ArchiveNight[]
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
    goal: entry.goal,
    image: entry.image ?? null,
    nights: entry.nights,
    store: byId.get(entry.target_id) ?? null,
  }))
}

export type ProjectTag = 'no-goal' | 'beyond-reach' | 'needs-data' | 'complete' | 'server-status'

export interface StatusInfo {
  tag: ProjectTag
  label: string
  /** Why the tag says what it says, when that is not obvious — e.g. the
   * server's status overriding what the suggested goal alone would show. */
  title?: string
}

/**
 * Completion (`complete` vs `needs-data`) is driven purely by the goal math —
 * `describeGoal`/`goalProgressPct` — regardless of whether the target has a
 * `list_projects` record at all. This used to short-circuit to a distinct
 * `archive-only` tag whenever `project.store` was null, which meant a target
 * like the real M42 (archive-only, ~279% of its own suggested goal) rendered
 * `archive only` instead of `complete`, with only the progress-bar color
 * carrying completion — provenance and completion are different axes and
 * shouldn't compete for one chip (see the design-fidelity review's item A6/
 * B6). Archive-only-ness is not lost by dropping it from here: it's still
 * fully identifiable via the card's meta line, since `summarizeSessions`
 * already renders "archive only — no per-session detail" precisely when
 * `project.store` is null, independent of this tag.
 *
 * `no-goal` covers both "not in the DSO catalogue at all" and "resolved but
 * no catalogued magnitude / photometry not credible" — three different
 * reasons (see integrationGoal.ts's describeGoal), one badge; the honest
 * distinction between them lives in the hours-row label and its title, where
 * there's room for a real sentence instead of a 9px tag.
 *
 * ## The server's status is never contradicted
 *
 * A target with a `list_projects` record carries the SERVER's own `status`
 * ("active" | "complete" | "paused" — seestar-mcp planning/projects.py), and
 * the server's planner acts on it: an "active" project is still one it plans
 * sessions for. The suggested goal above is the sidecar's display-only model.
 * So when the two disagree the server wins the tag:
 *
 *   - server says anything but "active" → that, verbatim ("complete" keeps
 *     its complete styling; anything else is shown as-is, neutrally);
 *   - server says "active" and the suggested goal is met → "active", titled
 *     to say the suggestion is met — never "complete", which the server has
 *     not said;
 *   - server says "active" and the goal is not met → "needs data", which
 *     agrees with it.
 *
 * Only a target with NO server record (archive-only) takes "complete" from
 * the goal model alone: there is no server status there to contradict.
 * Completion compares raw minutes (goalMet), never the rounded percentage.
 */
export function projectStatus(project: MergedProject, doubled: boolean): StatusInfo {
  const server = project.store?.status
  if (server != null && server !== 'active') {
    return server === 'complete'
      ? { tag: 'complete', label: 'complete', title: 'list_projects marks this project complete.' }
      : { tag: 'server-status', label: server, title: `list_projects status: ${server}` }
  }

  const display = describeGoal(project.goal)
  if (display.kind === 'beyond-reach') return { tag: 'beyond-reach', label: 'beyond reach' }
  if (display.kind !== 'goal') return { tag: 'no-goal', label: 'no goal' }
  if (!goalMet(project.totalMinutes, project.goal, doubled)) {
    return { tag: 'needs-data', label: 'needs data' }
  }
  if (server === 'active') {
    const hours = display.hours * (doubled ? 2 : 1)
    return {
      tag: 'server-status',
      label: 'active',
      title:
        `Past the suggested ${display.coarse ? '~' : ''}${hours.toFixed(1)} h, but list_projects ` +
        'still lists this project as active. The suggested figure is a display-only model; the ' +
        "project's status is the server's.",
    }
  }
  return { tag: 'complete', label: 'complete' }
}

/**
 * Null means "nothing to draw a proportional fill against" (no catalogue
 * record, no catalogued magnitude, photometry not credible, or beyond
 * practical reach) — the caller renders an empty rail instead of a bar with
 * a fabricated denominator. See integrationGoal.ts's goalProgressPct, which
 * this delegates to (shared with Tonight's ranked cards).
 *
 * Measures against `totalMinutes` (store + archive union), not the store's
 * own `collected_minutes` alone: a goal is about real integration time, and
 * the union exists because the store alone undercounts it for targets
 * recorded in both places.
 */
export function progressPct(project: MergedProject, doubled: boolean): number | null {
  return goalProgressPct(project.totalMinutes, project.goal, doubled)
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
 * Null means the target has no store record at all, so the caller renders a
 * distinct honest empty state rather than "0 sessions", which would falsely
 * imply a tracked project that simply hasn't logged anything.
 *
 * This is the card's one-line meta summary, not the full per-night history —
 * that's SessionHistory.tsx, which now itemises `project.nights` alongside
 * `store.sessions` (the archive scan does carry individual nights, via
 * `ArchiveNight` — an earlier version of this comment said otherwise, before
 * `/api/projects_combined` exposed them). Deliberately not folded in here
 * too: this summary is keyed on `last.median_fwhm`, a store-only concept
 * archive nights have no equivalent of, and a one-line meta summary is the
 * wrong place to start distinguishing session-shaped and night-shaped data —
 * that distinction is SessionHistory's whole job now.
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
