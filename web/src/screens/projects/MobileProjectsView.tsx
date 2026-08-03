import type { QaTargets } from '../../api/schemas'
import { QualityBar } from './QualityBar'
import { goalLabel } from '../../api/integrationGoal'
import { progressPct, projectStatus, type MergedProject } from './projects'
import styles from './MobileProjectsView.module.css'

export interface MobileProjectsViewProps {
  projects: readonly MergedProject[]
  headline: string
  qa: QaTargets | null
  onOpenQa: (targetId: string) => void
}

/** ProjectTag values are kebab-case, which CSS-module dot access cannot
 * reach — the same lookup ProjectCard uses. */
const TAG_CLASS: Record<string, string> = {
  complete: styles.complete,
  'needs-data': styles.needsData,
}

/**
 * Mobile — Projects.
 *
 * **Not in the design handoff**, which specified phone frames for Tonight and
 * Live only. An extension, so it keeps to what the desktop cards already say
 * rather than inventing a phone-specific reading of the data.
 *
 * The desktop card is a three-column grid with a thumbnail, two bars and four
 * lines of provenance. Here each project is one row: name, hours, the goal
 * state, and the quality bar — which is the thing worth scrolling for, since
 * "how much of this is keepable" is the question a phone glance is actually
 * asking.
 *
 * Dropped deliberately, not forgotten:
 *
 * - **The thumbnail.** Thirty-three images at 90px is most of the payload for
 *   decoration that identifies a target the name already names.
 * - **The provenance line** ("archive only — no per-session detail"). It
 *   qualifies numbers the desktop card shows and this row does not, so
 *   carrying it here would caveat something absent.
 *
 * The quality bar keeps its tap target: it opens that target's report on
 * Review & QA, the same handoff the desktop card offers.
 */
export function MobileProjectsView({ projects, headline, qa, onOpenQa }: MobileProjectsViewProps) {
  return (
    <div className={styles.root}>
      <div className={styles.eyebrow}>list_projects · multi-night integration</div>
      <h1 className={styles.heading}>{headline}</h1>

      <div className={styles.rows}>
        {projects.map((project) => {
          const pct = progressPct(project, false)
          const status = projectStatus(project, false)
          const verdicts = qa?.targets.find((t) => t.target_id === project.targetId)?.verdicts

          return (
            <div key={project.targetId} className={styles.row}>
              <div className={styles.head}>
                <span className={styles.name}>{project.targetId}</span>
                <span className={`${styles.tag} ${TAG_CLASS[status.tag] ?? ''}`}>{status.label}</span>
              </div>

              <div className={styles.figures}>
                <span className={styles.hours}>{(project.totalMinutes / 60).toFixed(1)} h</span>
                <span className={styles.goal}>{goalLabel(project.goal, false).text}</span>
              </div>

              {pct !== null && (
                <div className={styles.track}>
                  <div
                    className={`${styles.fill} ${pct >= 100 ? styles.complete : ''}`}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
              )}

              {verdicts && (
                <QualityBar verdicts={verdicts} onOpen={() => onOpenQa(project.targetId)} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
