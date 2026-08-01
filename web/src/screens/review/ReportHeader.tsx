import type { QaSummary } from '../../api/schemas'
import { formatMetric, keptPercent, METRIC_LABELS } from './qa'
import styles from './ReportHeader.module.css'

export interface ReportHeaderProps {
  /** The target we asked about. NOT `summary.target` — see below. */
  targetId: string
  displayName: string
  summary: QaSummary
  analysedAt: string | null
  stale: boolean
}

/**
 * Report header and the five-stat grid.
 *
 * **The target name comes from our own id, never from `summary.target`.**
 * That field is only populated when `qa_tier2` is called with `target=`, and
 * the sidecar always calls it with `paths=` — so it is null on every payload
 * this screen will ever see. Observed on a real recording, not assumed; a
 * header bound to it would have been correct in every test and absent in
 * production. seestar-mcp has since documented the same thing on the tool.
 *
 * Four of the five stats are the server's own numbers. The fifth, KEPT %, is
 * `kept / total` — arithmetic on two returned integers, not a quality
 * judgement, and it renders an absent state rather than `0.0%` when there is
 * nothing to divide.
 *
 * The design's fifth cell pairs DOMINANT CAUSE with a count and a plain-
 * language gloss ("91 subs · field rotation"). We show the cause the server
 * named and nothing more: the count would have to be re-derived and the
 * gloss invented.
 */
export function ReportHeader({
  targetId,
  displayName,
  summary,
  analysedAt,
  stale,
}: ReportHeaderProps) {
  const cause = summary.dominant_reject_cause

  return (
    <div className={styles.card}>
      <div className={styles.top}>
        <div>
          <div className={styles.eyebrow}>qa_tier2 · per-sub verdicts</div>
          <div className={styles.titleRow}>
            <h2 className={styles.title}>{displayName || targetId}</h2>
            <span className={styles.meta}>
              {analysedAt ? `analysed ${analysedAt.slice(0, 16).replace('T', ' ')} UTC` : 'analysed'}
              {' · '}
              {summary.total} subs
            </span>
          </div>
        </div>
        {stale && (
          <span className={styles.staleTag} title="The subs on disk have changed since this ran">
            STALE
          </span>
        )}
      </div>

      <div className={styles.stats}>
        <Stat
          label="KEPT"
          value={String(summary.kept)}
          sub={`of ${summary.total} subs · ${keptPercent(summary)}`}
          tone="pass"
        />
        <Stat
          label="MEDIAN wFWHM"
          value={formatMetric(summary.wfwhm)}
          sub="px · session ranking metric"
        />
        <Stat
          label="MEDIAN FWHM"
          value={formatMetric(summary.medians.fwhm)}
          sub="px · session median"
        />
        <Stat
          label="MEDIAN ECC"
          value={formatMetric(summary.medians.eccentricity)}
          sub="session median"
        />
        <Stat
          label="DOMINANT CAUSE"
          value={cause ? (METRIC_LABELS[cause] ?? cause) : '—'}
          sub={cause ? 'server-attributed' : 'none attributed'}
          tone={cause ? 'marginal' : undefined}
        />
      </div>
    </div>
  )
}

function Stat({
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
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <div className={`${styles.statValue} ${tone ? styles[tone] : ''}`}>{value}</div>
      <div className={styles.statSub}>{sub}</div>
    </div>
  )
}
