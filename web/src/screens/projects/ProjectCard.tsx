import { useId, useState } from 'react'
import { goalLabel as describeGoalLabel, hasNumericGoal } from '../../api/integrationGoal'
import type { QaVerdictCounts } from '../../api/schemas'
import { TargetThumb } from '../../ui/TargetThumb'
import { QualityBar } from '../../ui/QualityBar'
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
  'no-goal': styles.tagNoGoal,
  // Same neutral treatment as `no-goal`: a trusted result with no numeric bar
  // to show, not a failure — see integration_goal.py's BEYOND_REACH_HOURS
  // doc. Distinct label text carries the actual meaning.
  'beyond-reach': styles.tagNoGoal,
  'needs-data': styles.tagNeedsData,
  complete: styles.tagComplete,
  // The server's own list_projects status, shown because it disagrees with
  // what the suggested goal alone would say (see projectStatus). Neutral: it
  // is the server's word, not a judgement of ours.
  'server-status': styles.tagNoGoal,
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
  /** This target's QA verdict mix, when it has been analysed. Absent — not
   * zeroed — otherwise, so the card renders no quality bar rather than an
   * empty one, which would read as "nothing passed". */
  verdicts?: QaVerdictCounts
  /** Opens this target's report on the Review & QA screen. */
  onOpenQa?: () => void
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
 * **No interactive element nests inside another.** The card used to BE a
 * `<button>`, and the quality bar's "open the QA report" button sat inside
 * it — invalid DOM, and its click bubbled into onSelect, persisting a
 * selection nobody asked for. Now the card is a plain box and selection is
 * its own `<button>` (`.selectArea`), stretched over the whole card beneath
 * the content, so the whole card still selects on click. Controls that must
 * sit above it — the quality bar — are raised out of its way, siblings in
 * the DOM rather than children of it. So is every element with a tooltip
 * (the status tag, the goal label, the FWHM note on the meta line): beneath
 * the button, hovering them hovered the button and the title never showed.
 * Their text is also the button's accessible description.
 *
 * The doubling toggle (view-only, localStorage-persisted — see doubling.ts)
 * sits the same way: a separate button absolutely positioned inside the
 * card's own rounded box (top-right corner), only rendered when there is a
 * real number to double. `titleRowReserved` reserves the matching
 * horizontal space in the title row so the toggle never overlaps the status
 * tag, which also lives in that corner.
 *
 * The 96px cover image (`project.image`, never absent-by-design any more —
 * see projects.ts's MergedProject.image doc comment) renders through the
 * same shared TargetThumb as PlanCard's thumbnail, so both surfaces share
 * one own-vs-survey honesty guarantee instead of two implementations of it.
 */
export function ProjectCard({
  project,
  selected,
  onSelect,
  verdicts,
  onOpenQa,
}: ProjectCardProps) {
  const [doubled, setDoubled] = useState(() => isGoalDoubled(project.targetId))
  const status = projectStatus(project, doubled)
  const pct = progressPct(project, doubled)
  const summary = summarizeSessions(project)
  const goal = describeGoalLabel(project.goal, doubled)
  const canDouble = hasNumericGoal(project.goal)
  const metaTitle = summary?.fwhmAbsent ? FWHM_ABSENT_TITLE : undefined
  // Every tooltip on the card, also given to the select button as its
  // accessible description: a keyboard or screen-reader user reaches the
  // card through that button and never hovers anything.
  // A survey cover's credit is attribution the survey requires (TargetThumb's
  // doc); under .selectArea its title could never be hovered either.
  const surveyCredit =
    project.image?.source === 'survey' ? `Survey image: ${project.image.credit ?? 'sky survey'}` : undefined
  const tips = [status.title, goal.title, metaTitle, surveyCredit].filter((t): t is string => !!t)
  const tipsId = useId()
  // A titled element is raised above .selectArea (see `.tip` in the CSS) so
  // hovering it shows its title. Raised, it takes the click the button
  // beneath it would have had; forwarding it keeps "click anywhere selects".
  const tipClass = (title: string | undefined) => (title ? ` ${styles.tip}` : '')
  const tipProps = (title: string | undefined) => (title ? { title, onClick: onSelect } : {})

  return (
    <div className={styles.cardWrap}>
      <div className={`${styles.card} ${selected ? styles.selected : ''}`}>
        {/* Selection. Empty and stretched over the whole card, so clicking
            anywhere on it selects — without making the card itself a
            button that other controls would have to nest inside. */}
        <button
          type="button"
          className={styles.selectArea}
          aria-pressed={selected}
          aria-label={`${project.targetId} — ${project.targetName}`}
          aria-describedby={tips.length > 0 ? tipsId : undefined}
          onClick={onSelect}
          data-testid="project-card"
        />
        {tips.length > 0 && (
          <span id={tipsId} className={styles.srOnly}>
            {tips.join(' ')}
          </span>
        )}
        <TargetThumb
          image={project.image}
          alt={project.targetName}
          className={`${styles.cover}${tipClass(surveyCredit)}`}
          onClick={surveyCredit ? onSelect : undefined}
        />
        <div className={styles.body}>
          <div className={`${styles.titleRow} ${canDouble ? styles.titleRowReserved : ''}`}>
            <span className={styles.id}>{project.targetId}</span>
            <span
              className={`${styles.tag} ${TAG_CLASS[status.tag]}${tipClass(status.title)}`}
              {...tipProps(status.title)}
            >
              {status.label}
            </span>
          </div>
          <div className={styles.name}>{project.targetName}</div>
          <div className={styles.spacer} />
          <div className={styles.hoursRow}>
            <span className={styles.hours}>{formatHours(project.totalMinutes)}</span>
            <span className={`${styles.goal}${tipClass(goal.title)}`} {...tipProps(goal.title)}>
              {goal.text}
            </span>
          </div>
          <div
            className={`${styles.track} ${pct === null ? styles.trackEmpty : ''}`}
            data-testid="progress-track"
          >
            {pct !== null && (
              // The bar measures captured time against the SUGGESTED goal,
              // so its fill says whether that suggestion is met — `pct` is
              // 100 only when goalMet is true (integrationGoal.ts). It can
              // now differ from the tag, deliberately: a store project the
              // server still lists as "active" shows a met suggestion here
              // and the server's "active" in the tag.
              <div
                className={`${styles.fill} ${pct >= 100 ? styles.fillComplete : styles.fillProgress}`}
                style={{ width: `${pct}%` }}
              />
            )}
          </div>
          {/* Collected-vs-goal is the bar above. This one answers the
              question that changes what you do next: how much of what you
              collected is keepable. A target can sit at 100% of its suggested
              time and be mostly rejects. Rendered only when the target has
              actually been analysed. */}
          {verdicts && (
            // Raised above the selection area, so its own button takes the
            // click and the card is not selected along with it.
            <div className={styles.raised}>
              <QualityBar
                verdicts={verdicts}
                onOpen={onOpenQa}
                coverage={{ storeMinutes: project.storeMinutes, archiveMinutes: project.archiveMinutes }}
              />
            </div>
          )}
          <div className={styles.provenance}>{provenanceLabel(project)}</div>
          <div className={`${styles.meta}${tipClass(metaTitle)}`} {...tipProps(metaTitle)}>
            {summary ? summary.text : 'archive only — no per-session detail (aggregate minutes only)'}
          </div>
        </div>
      </div>
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
