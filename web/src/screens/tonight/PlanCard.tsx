import { formatHours, goalLabel, goalProgressPct } from '../../api/integrationGoal'
import type { IntegrationGoal, PlanTarget } from '../../api/schemas'
import { TargetThumb } from '../../ui/TargetThumb'
import { targetTypeLabel } from './targetType'
import { localHhMm, parse, zoneLabel } from './timeline'
import styles from './PlanCard.module.css'

/** Time captured and the suggested goal for this target, joined client-side
 * from `/api/projects_combined` by id (see TonightScreen) — plan_targets
 * itself carries no integration numbers, and the ranker's own "N min
 * collected" reason string is prose for a human, not a value this component
 * may parse back out. `null` when the id has no projects_combined entry at
 * all (a target genuinely never observed, or a Caldwell/alias id — like
 * "C14" vs the union's "C14_DoubleCluster" — the two sources don't yet
 * agree on): renders no progress row at all rather than a fabricated zero.
 * Never doubled here — the doubling control is a Projects-screen concept
 * (see doubling.ts); Tonight shows the model's own number as-is. */
export interface PlanCardProgress {
  totalMinutes: number
  goal: IntegrationGoal | null
}

/**
 * The reason tags are the point of the screen — a bare score is not trustworthy,
 * so the ranker shows its work. These strings come from ranker.py, not from the
 * client.
 *
 * The thumbnail (handback 8) is no longer absent by design — `plan_targets`
 * gains an optional `image` per target (the user's own capture, a sky-survey
 * cutout, or `null`/absent when neither resolves), rendered through the
 * shared TargetThumb so Tonight and Projects get the same three states and
 * the same own-vs-survey honesty guarantee. The LP filter chip stays absent
 * (lp_fit is computed server-side but not returned, handback 5) — that gap
 * is unrelated to imagery and still not faked.
 */
export function PlanCard({
  target,
  progress = null,
}: {
  target: PlanTarget
  progress?: PlanCardProgress | null
}) {
  const [from, to] = target.best_window_utc
  const reasons = target.reasons.filter((r) => !r.startsWith('best window '))
  const goal = progress ? goalLabel(progress.goal, false) : null
  const pct = progress ? goalProgressPct(progress.totalMinutes, progress.goal, false) : null

  return (
    <article className={styles.card}>
      <div className={styles.head}>
        <TargetThumb image={target.image} alt={target.name} className={styles.thumb} />
        <div className={styles.headBody}>
          <div className={styles.titleRow}>
            <span className={styles.id}>{target.id}</span>
            <span className={styles.scoreWrap}>
              <span className={styles.score}>{target.score}</span>
              <span className={styles.scoreLabel}>score</span>
            </span>
          </div>
          <div className={styles.name}>{target.name}</div>
          <div className={styles.chips}>
            {/* A coarse family label (nebula/galaxy/cluster/…), not the raw
                snake_case TARGET_TYPES enum — see targetType.ts for why this
                mapping lives client-side and where the 8 source values come
                from. */}
            <span className={styles.chip}>{targetTypeLabel(target.type)}</span>
          </div>
        </div>
      </div>

      <div className={styles.stats}>
        <div className={styles.stat}>
          {/* The design's own label is `BEST WINDOW UTC` — but this value is
              not UTC, it's the browser's local clock (see timeline.ts's
              localHhMm/zoneLabel), so copying that text verbatim would be
              actively false. zoneLabel names the zone actually being shown
              instead: it reads "UTC" when that happens to be zero offset —
              matching the design exactly in that one case — and "UTC±H[:MM]"
              otherwise. See handback-to-seestar-ai.md item 16 for why the
              observing site's own zone isn't nameable here today. */}
          <div className={styles.statLabel} title="Browser-local clock time — may not match the observing site's zone.">
            BEST WINDOW {zoneLabel(parse(from))}
          </div>
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

      {progress && (
        <div className={styles.progressSection}>
          <div className={styles.statLabel}>TIME CAPTURED</div>
          <div className={styles.progressRow}>
            <span className={styles.progressHours}>{formatHours(progress.totalMinutes)}</span>
            {goal && (
              <span className={styles.progressGoal} title={goal.title}>
                {goal.text}
              </span>
            )}
          </div>
          <div
            className={`${styles.progressTrack} ${pct === null ? styles.progressTrackEmpty : ''}`}
            data-testid="plan-progress-track"
          >
            {pct !== null && (
              <div
                className={`${styles.progressFill} ${pct >= 100 ? styles.progressFillComplete : ''}`}
                style={{ width: `${pct}%` }}
              />
            )}
          </div>
        </div>
      )}

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
        {/* Not wired yet, not forgotten: there is no detail screen in slice 1
            for it to open. Revisit when a target-detail view exists. */}
        <button className={styles.secondary}>Detail</button>
      </div>
    </article>
  )
}
