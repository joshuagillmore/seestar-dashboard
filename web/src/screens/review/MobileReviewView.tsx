import type { QaSubVerdict, QaSummary, QaTarget } from '../../api/schemas'
import { MetricChart } from './MetricChart'
import {
  formatMetric,
  isUnanalysed,
  keptPercent,
  noReasonText,
  thresholdLinesFor,
  toneFor,
} from './qa'
import { ErrorNote } from './ReviewStates'
import { analysedLabel } from './statusHelpers'
import styles from './MobileReviewView.module.css'

/** Fewer than the desktop table's twelve. The charts still carry the whole
 * distribution; on a phone the rows are evidence you scroll through, and
 * twelve stacked cards buries the charts above them. */
const SUB_ROWS = 6

export interface MobileReviewViewProps {
  targets: readonly QaTarget[]
  selected: string | null
  onSelect: (targetId: string) => void
  summary: QaSummary | null
  displayName: string | null
  /** Rendered instead of a report — loading, unreadable, not analysed,
   * running, failed. The screen builds it from the same AnalysisState the
   * desktop layout uses (ReviewStates.tsx), so the two cannot drift again;
   * this view only decides where it goes. */
  state: React.ReactNode
  /** When the report was computed, and whether the subs on disk have
   * changed since. A stale report is a usable result with a caveat, and the
   * caveat must be as visible here as on desktop. */
  analysedAt?: string | null
  stale?: boolean
  /** The way out of a stale report (a Re-analyse button), shared with
   * desktop. */
  staleNotice?: React.ReactNode
  /** The screen's error, when it is not already the state's own message —
   * e.g. a start the sidecar refused. */
  errorNote?: string | null
}

/**
 * Mobile — Review & QA.
 *
 * **Not in the design handoff.** The design specified phone frames for
 * Tonight and Live only, so this is an extension rather than an
 * implementation, and it follows the two rules the desktop screen already
 * obeys rather than inventing a phone-specific idea of QA.
 *
 * Three departures from the desktop composition, all forced by 375px:
 *
 * 1. **The target picker becomes a `<select>`.** A 300px list beside the
 *    report is the whole desktop layout; stacked on a phone it would be
 *    twenty-two rows of scrolling before the report. A native select also
 *    gets the platform's own picker, which beats anything rebuilt here.
 *
 * 2. **The per-sub table becomes cards.** Seven columns cannot be read at
 *    this width. Each sub keeps its verdict badge, its metrics and — the
 *    part that must not be dropped — the server's own reason text, which is
 *    the auditable half of the verdict.
 *
 * 3. **One chart, not two.** Eccentricity only. The star-count panel exists
 *    on desktop to be read *against* it on a shared x-scale, and two stacked
 *    44px charts on a phone invite exactly the comparison the narrow width
 *    makes unreliable.
 *
 * The verdict filter is deliberately absent: with six rows shown, filtering
 * them is a control that costs more space than it saves.
 */
export function MobileReviewView({
  targets,
  selected,
  onSelect,
  summary,
  displayName,
  state,
  analysedAt = null,
  stale = false,
  staleNotice = null,
  errorNote = null,
}: MobileReviewViewProps) {
  return (
    <div className={styles.root}>
      <div className={styles.eyebrow}>qa_tier2 · morning-after triage</div>

      <label className={styles.pickerLabel}>
        <span className={styles.pickerCaption}>Target</span>
        <select
          className={styles.picker}
          value={selected ?? ''}
          onChange={(e) => onSelect(e.target.value)}
        >
          <option value="" disabled>
            Pick a target…
          </option>
          {[...targets]
            .sort((a, b) => b.sub_count - a.sub_count)
            .map((t) => (
              <option key={t.target_id} value={t.target_id}>
                {t.display_name} · {t.sub_count} subs
                {t.status === 'complete' ? ' · analysed' : ''}
              </option>
            ))}
        </select>
      </label>

      {summary == null ? (
        <div className={styles.state}>{state}</div>
      ) : (
        <>
          <div className={styles.titleRow}>
            <h1 className={styles.heading}>{displayName ?? selected}</h1>
            {stale && (
              <span
                className={styles.staleTag}
                title="The subs on disk have changed since this ran"
              >
                STALE
              </span>
            )}
          </div>
          <div className={styles.meta}>
            {analysedLabel(analysedAt)} · {summary.total} subs
          </div>

          {staleNotice}

          <div className={styles.tiles}>
            <Tile label="KEPT" value={String(summary.kept)} sub={keptPercent(summary)} tone="pass" />
            <Tile label="TOTAL" value={String(summary.total)} sub="subs" />
            <Tile label="MED wFWHM" value={formatMetric(summary.wfwhm)} sub="px" />
            <Tile
              label="DOMINANT"
              value={summary.dominant_reject_cause ?? '—'}
              sub={summary.dominant_reject_cause ? 'cause' : 'none attributed'}
              tone={summary.dominant_reject_cause ? 'marginal' : undefined}
            />
          </div>

          <MetricChart
            eyebrow="Per-sub eccentricity"
            subs={summary.subs}
            metric="eccentricity"
            buckets={40}
            height={84}
            totalSubs={summary.total}
            thresholds={thresholdLinesFor('eccentricity', summary.thresholds)}
          />

          <div className={styles.subs}>
            {summary.subs.slice(0, SUB_ROWS).map((sub) => (
              <SubRow key={sub.name} sub={sub} />
            ))}
            {summary.subs.length > SUB_ROWS && (
              <p className={styles.more}>
                showing {SUB_ROWS} of {summary.subs.length} — the chart above carries the whole
                session
              </p>
            )}
          </div>
        </>
      )}

      {errorNote && <ErrorNote text={errorNote} />}
    </div>
  )
}

function Tile({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: string
  sub: string
  tone?: 'pass' | 'marginal'
}) {
  return (
    <div className={styles.tile}>
      <div className={styles.tileLabel}>{label}</div>
      <div className={`${styles.tileValue} ${tone ? styles[tone] : ''}`}>{value}</div>
      <div className={styles.tileSub}>{sub}</div>
    </div>
  )
}

function SubRow({ sub }: { sub: QaSubVerdict }) {
  const tone = toneFor(sub.verdict)
  const unanalysed = isUnanalysed(sub)

  return (
    <div className={styles.sub}>
      <div className={styles.subHead}>
        <span className={`${styles.badge} ${styles[unanalysed ? 'unanalysed' : tone]}`}>
          {unanalysed ? 'NOT ANALYSED' : sub.verdict}
        </span>
        {/* The stem is long and the distinguishing part is the timestamp at
            the end, so this truncates from the LEFT. */}
        <span className={styles.subName} title={sub.name} dir="rtl">
          {sub.name}
        </span>
      </div>

      {!unanalysed && (
        <div className={styles.metrics}>
          <span>FWHM {formatMetric(sub.metrics.fwhm)}</span>
          <span>ECC {formatMetric(sub.metrics.eccentricity)}</span>
          <span>SNR {formatMetric(sub.metrics.snr, 1)}</span>
          <span>{formatMetric(sub.metrics.star_count, 0)} stars</span>
        </div>
      )}

      {/* Verbatim, never shortened — this is the audit trail the QA policy
          requires, and a phone is not a reason to drop it. */}
      <p className={styles.reason}>
        {unanalysed
          ? sub.metrics.error
          : sub.reasons.length > 0
            ? sub.reasons.join(' · ')
            : noReasonText(sub)}
      </p>
    </div>
  )
}
