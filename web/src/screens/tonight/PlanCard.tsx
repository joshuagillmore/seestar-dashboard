import { formatHours, goalLabel, goalProgressPct } from '../../api/integrationGoal'
import type { IntegrationGoal, PlanTarget, QaVerdictCounts } from '../../api/schemas'
import { QualityBar } from '../../ui/QualityBar'
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
 * agree on; a server-side id mismatch, handed back rather than papered over
 * with an alias table here): renders no progress row at all rather than a
 * fabricated zero, and Detail's reason is qualified by the id.
 * Never doubled here — the doubling control is a Projects-screen concept
 * (see doubling.ts); Tonight shows the model's own number as-is.
 *
 * `storeMinutes`/`archiveMinutes` are the same entry's split of
 * `totalMinutes`. QA verdicts cover the archive only, so the quality bar
 * needs them to say so beside a total that includes the store. */
export interface PlanCardProgress {
  totalMinutes: number
  storeMinutes: number
  archiveMinutes: number
  goal: IntegrationGoal | null
}

/**
 * Why Detail is disabled, when it is — each says only what is actually known:
 *
 * - `checking`: the projects_combined lookup has not answered yet.
 * - `lookup-failed`: it failed, so whether there are subs is UNKNOWN. Saying
 *   "no subs on disk" here would be a claim about the disk nobody checked.
 * - `no-entry`: nothing on record under THIS id. Usually a target never
 *   shot — but a Caldwell/alias id (plan_targets' "C14" vs the union's
 *   "C14_DoubleCluster") misses the same way, so the message is qualified
 *   by the id rather than asserting the target has no subs.
 * - `no-subs`: on record, with no archive minutes: nothing to score.
 */
export type ReviewUnavailable = 'checking' | 'lookup-failed' | 'no-entry' | 'no-subs'

function detailTitle(id: string, reason: ReviewUnavailable | undefined): string {
  switch (reason) {
    case 'checking':
      return `Checking whether ${id} has subs on disk…`
    case 'lookup-failed':
      return `Could not check whether ${id} has subs on disk — the projects_combined lookup failed`
    case 'no-entry':
      return `No archive entry under the id ${id} — nothing to review under that name`
    case 'no-subs':
    default:
      return `No subs on disk for ${id} yet — nothing to review`
  }
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
  onOpenQa,
  reviewUnavailable,
  verdicts,
}: {
  target: PlanTarget
  progress?: PlanCardProgress | null
  /** Per-sub QA verdict counts for this target, when one has been analysed.
   * Absent for a target never shot or never scored — the bar is then omitted
   * entirely rather than rendered empty, because an empty bar reads as
   * "nothing passed" when the truth is that nobody measured. */
  verdicts?: QaVerdictCounts
  /** Open this target's Review & QA report. Passed ONLY when the target has
   * subs on disk — see TonightScreen, which decides that from the same
   * archive scan the Review picker is built from. Absent means there is
   * nothing to review, and Detail renders disabled rather than navigating to
   * a screen that would silently ignore the target (useQaReview drops a
   * pending target it cannot find, which would look like a dead button). */
  onOpenQa?: () => void
  /** Why Detail is disabled when `onOpenQa` is absent — see
   * ReviewUnavailable. Defaults to `no-subs`. */
  reviewUnavailable?: ReviewUnavailable
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
          {/* How much of that time is actually keepable — the question the
              hours bar above cannot answer. Same component and same three
              tones as Projects and the QA screen, so a bar here means what a
              bar there means. Not clickable on this screen: Detail below is
              already the route to the report, and two affordances to one
              place on one card is noise. */}
          {verdicts && (
            <QualityBar
              verdicts={verdicts}
              coverage={{ storeMinutes: progress.storeMinutes, archiveMinutes: progress.archiveMinutes }}
            />
          )}
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
          title="Motion requires an approval gate that doesn't exist yet — slice 3 shipped the Live session screen without one by deliberate choice (docs/superpowers/specs/2026-07-30-slice-3-live-session.md §0: the user does not want telescope control from the dashboard); a future slice would need a real coordination protocol with the run-session skill first"
        >
          Hand to run-session
        </button>
        {/* Opens this target's report on Review & QA. Disabled — with the
            reason on the button — when the archive holds no subs for it,
            which is the ordinary case for a target the planner is suggesting
            precisely because you have not shot it yet. */}
        <button
          className={styles.secondary}
          onClick={onOpenQa}
          disabled={!onOpenQa}
          title={
            onOpenQa ? `Open ${target.id} on Review & QA` : detailTitle(target.id, reviewUnavailable)
          }
        >
          Detail
        </button>
      </div>
    </article>
  )
}
