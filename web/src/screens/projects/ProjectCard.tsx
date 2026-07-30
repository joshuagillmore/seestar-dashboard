import {
  formatHours,
  progressPct,
  projectStatus,
  provenanceLabel,
  summarizeSessions,
  type MergedProject,
  type ProjectTag,
} from './projects'
import styles from './ProjectCard.module.css'

const TAG_CLASS: Record<ProjectTag, string> = {
  'archive-only': styles.tagArchiveOnly,
  'no-goal': styles.tagNoGoal,
  'needs-data': styles.tagNeedsData,
  complete: styles.tagComplete,
}

const FWHM_ABSENT_TITLE =
  'median_fwhm is null on every recorded session — see docs/handback-to-seestar-ai.md item 7'

export interface ProjectCardProps {
  project: MergedProject
  selected: boolean
  onSelect: () => void
}

/**
 * Integration-led per the phase-2 ruling: hours collected is the headline
 * stat, not progress against a goal — every real project has goal_minutes 0,
 * so a goal-progress card would have nothing to show. The progress track
 * below only appears once `progressPct` returns non-null, which requires a
 * goal to actually be set (see projects.ts) — never true against today's
 * data, always false-tested with a synthetic project in ProjectCard.test.tsx.
 */
export function ProjectCard({ project, selected, onSelect }: ProjectCardProps) {
  const status = projectStatus(project)
  const pct = progressPct(project)
  const summary = summarizeSessions(project)

  const goalLabel = !project.store
    ? null // no store record at all — there is no goal concept to report
    : pct === null
      ? 'no goal set'
      : `of ${formatHours(project.store.goal_minutes)} goal`

  return (
    <button
      type="button"
      className={`${styles.card} ${selected ? styles.selected : ''}`}
      aria-pressed={selected}
      onClick={onSelect}
    >
      <div className={styles.titleRow}>
        <span className={styles.id}>{project.targetId}</span>
        <span className={`${styles.tag} ${TAG_CLASS[status.tag]}`}>{status.label}</span>
      </div>
      <div className={styles.name}>{project.targetName}</div>
      <div className={styles.spacer} />
      <div className={styles.hoursRow}>
        <span className={styles.hours}>{formatHours(project.totalMinutes)}</span>
        {goalLabel && <span className={styles.goal}>{goalLabel}</span>}
      </div>
      {pct !== null && (
        <div className={styles.track} data-testid="progress-track">
          <div
            className={`${styles.fill} ${status.tag === 'complete' ? styles.fillComplete : styles.fillProgress}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      <div className={styles.provenance}>{provenanceLabel(project)}</div>
      <div
        className={styles.meta}
        title={summary?.fwhmAbsent ? FWHM_ABSENT_TITLE : undefined}
      >
        {summary ? summary.text : 'archive only — no per-session detail (aggregate minutes only)'}
      </div>
    </button>
  )
}
