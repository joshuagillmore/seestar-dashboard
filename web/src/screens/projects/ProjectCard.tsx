import { useState } from 'react'
import { goalLabel as describeGoalLabel, hasNumericGoal } from '../../api/integrationGoal'
import { isGoalDoubled, toggleGoalDoubled } from './doubling'
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
  // Same neutral treatment as `no-goal`: a trusted result with no numeric bar
  // to show, not a failure — see integration_goal.py's BEYOND_REACH_HOURS
  // doc. Distinct label text carries the actual meaning.
  'beyond-reach': styles.tagNoGoal,
  'needs-data': styles.tagNeedsData,
  complete: styles.tagComplete,
}

const FWHM_ABSENT_TITLE =
  'median_fwhm is null on every recorded session — see docs/handback-to-seestar-ai.md item 7'

const DOUBLE_TITLE =
  'View only — doubles the suggested figure locally, not sent to the telescope (set_project_goal is not in the allowlist). ' +
  'SNR improves with the square root of exposure time, so a doubling is roughly 41% better SNR, not double the image.'

export interface ProjectCardProps {
  project: MergedProject
  selected: boolean
  onSelect: () => void
}

/**
 * Integration-led per the phase-2 ruling: hours collected is the headline
 * stat. The goal line and progress track are driven entirely by
 * `project.goal` (the sidecar's suggested-integration-time model), not by
 * `store`/`store.goal_minutes` — the store's own goal field is unused by any
 * real project and stays 0 regardless. A goal line always renders something
 * (never a bare blank): four honest states — not catalogued, no catalogued
 * magnitude, photometry not credible, beyond practical reach — collapse to
 * two neutral tag words ("no goal" / "beyond reach") but stay distinct in
 * the label text and its title, per the design's own gap here (see
 * integrationGoal.ts's describeGoal).
 *
 * The doubling toggle (view-only, localStorage-persisted — see doubling.ts)
 * sits as a sibling overlay, not nested inside the card's own selection
 * button: two nested `<button>`s is invalid content and would double-fire
 * clicks, so the toggle is a separate button stacked visually on the card
 * instead, and only rendered when there is a real number to double.
 */
export function ProjectCard({ project, selected, onSelect }: ProjectCardProps) {
  const [doubled, setDoubled] = useState(() => isGoalDoubled(project.targetId))
  const status = projectStatus(project, doubled)
  const pct = progressPct(project, doubled)
  const summary = summarizeSessions(project)
  const goal = describeGoalLabel(project.goal, doubled)
  const canDouble = hasNumericGoal(project.goal)

  return (
    <div className={styles.cardWrap}>
      <button
        type="button"
        className={`${styles.card} ${selected ? styles.selected : ''}`}
        aria-pressed={selected}
        onClick={onSelect}
        data-testid="project-card"
      >
        <div className={styles.titleRow}>
          <span className={styles.id}>{project.targetId}</span>
          <span className={`${styles.tag} ${TAG_CLASS[status.tag]}`}>{status.label}</span>
        </div>
        <div className={styles.name}>{project.targetName}</div>
        <div className={styles.spacer} />
        <div className={styles.hoursRow}>
          <span className={styles.hours}>{formatHours(project.totalMinutes)}</span>
          <span className={styles.goal} title={goal.title}>
            {goal.text}
          </span>
        </div>
        <div
          className={`${styles.track} ${pct === null ? styles.trackEmpty : ''}`}
          data-testid="progress-track"
        >
          {pct !== null && (
            // Keyed off `pct` itself, not `status.tag`: an archive-only
            // target (tag stays 'archive-only' regardless — see
            // projectStatus's doc comment) can still fully clear its own
            // suggested goal, e.g. the real M42 at 279% — its fill must read
            // as met (pass), not as still-in-progress (accent), even though
            // its badge says "archive only" for an unrelated reason.
            <div
              className={`${styles.fill} ${pct >= 100 ? styles.fillComplete : styles.fillProgress}`}
              style={{ width: `${pct}%` }}
            />
          )}
        </div>
        <div className={styles.provenance}>{provenanceLabel(project)}</div>
        <div
          className={styles.meta}
          title={summary?.fwhmAbsent ? FWHM_ABSENT_TITLE : undefined}
        >
          {summary ? summary.text : 'archive only — no per-session detail (aggregate minutes only)'}
        </div>
      </button>
      {canDouble && (
        <button
          type="button"
          className={styles.doubleToggle}
          aria-pressed={doubled}
          aria-label="Double the suggested integration goal (view only)"
          title={DOUBLE_TITLE}
          onClick={() => setDoubled(toggleGoalDoubled(project.targetId))}
        >
          2×
        </button>
      )}
    </div>
  )
}
