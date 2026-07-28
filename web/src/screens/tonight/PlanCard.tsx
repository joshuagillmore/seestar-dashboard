import type { PlanTarget } from '../../api/schemas'
import { localHhMm, parse } from './timeline'
import styles from './PlanCard.module.css'

/**
 * The reason tags are the point of the screen — a bare score is not trustworthy,
 * so the ranker shows its work. These strings come from ranker.py, not from the
 * client.
 *
 * Two elements of the handoff card are absent by design: the thumbnail (no tool
 * returns imagery, handback 8) and the LP filter chip (lp_fit is computed
 * server-side but not returned, handback 5). Neither is faked.
 */
export function PlanCard({ target }: { target: PlanTarget }) {
  const [from, to] = target.best_window_utc
  const reasons = target.reasons.filter((r) => !r.startsWith('best window '))

  return (
    <article className={styles.card}>
      <div className={styles.head}>
        <div className={styles.titleRow}>
          <span className={styles.id}>{target.id}</span>
          <span className={styles.scoreWrap}>
            <span className={styles.score}>{target.score}</span>
            <span className={styles.scoreLabel}>score</span>
          </span>
        </div>
        <div className={styles.name}>{target.name}</div>
        <div className={styles.chips}>
          <span className={styles.chip}>{target.type}</span>
        </div>
      </div>

      <div className={styles.stats}>
        <div className={styles.stat}>
          <div className={styles.statLabel}>BEST WINDOW</div>
          <div className={styles.statValue}>
            {localHhMm(parse(from))}–{localHhMm(parse(to))}
          </div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>RECOMMENDED</div>
          <div className={styles.statValue}>
            {target.recommended_subs} × {target.recommended_exposure_s} s
          </div>
        </div>
      </div>

      <div className={styles.reasons}>
        <div className={styles.statLabel}>WHY — REASON TAGS</div>
        <ul className={styles.reasonList}>
          {reasons.map((reason) => (
            <li key={reason} className={styles.reasonRow}>
              <span className={styles.plus}>+</span>
              <span>{reason}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className={styles.actions}>
        <button
          className={styles.primary}
          disabled
          title="Motion requires the approval gate — slice 3"
        >
          Hand to run-session
        </button>
        <button className={styles.secondary}>Detail</button>
      </div>
    </article>
  )
}
