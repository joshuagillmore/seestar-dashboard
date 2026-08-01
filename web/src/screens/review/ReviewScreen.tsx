import type { Health, SiteProfile } from '../../api/schemas'
import { AppShell } from '../../shell/AppShell'
import { Sidebar } from '../../shell/Sidebar'
import { TopBar } from '../../shell/TopBar'
import type { View } from '../../shell/view'
import { MetricChart } from './MetricChart'
import { RejectionsByCause } from './RejectionsByCause'
import { ReportHeader } from './ReportHeader'
import { SubTable } from './SubTable'
import { TargetPicker } from './TargetPicker'
import { useQaReview } from './useQaReview'
import styles from './ReviewScreen.module.css'

export interface ReviewScreenProps {
  view: View
  onNavigate: (view: View) => void
  site: SiteProfile | null
  health: Health | null
}

/**
 * Slice 4 — Review & QA. Morning-after triage over `qa_tier2`.
 *
 * Unblocked by seestar-mcp shipping work-order item 1: `_compact_report` used
 * to strip the per-sub metric arrays, and this screen is *made of* them, so
 * there was nothing partial to build until they landed.
 *
 * ## What this screen will not do
 *
 * **It never starts an analysis on load.** `qa_tier2` is minutes long over
 * 200–1400 subs. Mount fetches a listing; selecting a target reads status;
 * only a click reaches `/api/qa_analysis_start`. See `useQaReview`.
 *
 * **It renders verdicts, never computes them.** Every PASS/MARGINAL/REJECT
 * and every reason string is the server's, shown verbatim. No metric is
 * compared to a cutoff anywhere in this directory.
 *
 * ## Three things from the design that are deliberately absent
 *
 * Each is a missing data source, not an unfinished element, and each ships an
 * honest gap rather than a plausible-looking placeholder:
 *
 * 1. **The dashed threshold lines on the trend chart.** The design specifies
 *    lines at the reject and marginal cutoffs and says, correctly, "never
 *    hardcode them in the client — ship them in the report payload." They are
 *    not in the payload: `summary` carries `medians` and no thresholds, and
 *    the numbers exist only as prose inside `reasons[]`. Parsing them out of
 *    sentences would be re-deriving a verdict. Bars are toned by the server's
 *    own per-sub verdict instead, which carries the same information without
 *    inventing a number. Handback item 26.
 *
 * 2. **The pattern callout.** The design's highest-value element — one
 *    sentence explaining *why* frames failed — and it says explicitly that it
 *    "should come from the agent, not a template". There is no agent output
 *    channel in this repo, and writing the template it warns against would be
 *    worse than leaving the space empty.
 *
 * 3. **The master image card and the seestar-refine actions.** Both are write
 *    paths: `stack_keep_list`, `stretch_master` and the PixInsight handoff
 *    have no route by design, and post-processing has since left the MCP
 *    surface entirely. The design says to disable buttons whose backend is
 *    missing — but ours are missing permanently and structurally, so three
 *    dead buttons would imply a capability that is never coming. A line of
 *    text is the honest version.
 */
export function ReviewScreen({ view, onNavigate, site, health }: ReviewScreenProps) {
  const { phase, targets, selected, status, starting, error, select, analyse } = useQaReview()

  const selectedTarget = targets?.targets.find((t) => t.target_id === selected) ?? null
  // Narrowed once, here, so the render below never has to re-test the union.
  // `stale` carries a real report and must keep rendering one — it is a
  // usable result with a caveat, not an absent one.
  const finished =
    status != null && (status.status === 'complete' || status.status === 'stale') ? status : null
  const report = finished?.report

  return (
    <AppShell
      topBar={<TopBar site={site} replay={health?.replay ?? false} />}
      sidebar={
        <Sidebar
          site={site}
          verdict={null}
          gpsWarning={null}
          view={view}
          onNavigate={onNavigate}
        />
      }
    >
      <div className={styles.screen}>
        <header className={styles.header}>
          <div>
            <div className={styles.eyebrow}>qa_tier2 · morning-after triage</div>
            <h1 className={styles.heading}>Review &amp; QA</h1>
          </div>
        </header>

        {phase === 'loading' && <div className={styles.skeleton} />}

        {phase === 'error' && (
          <div className={styles.state}>
            <p className={styles.stateText}>
              Could not read the archive listing.{error ? ` ${error}` : ''}
            </p>
          </div>
        )}

        {phase === 'ready' && targets && (
          <div className={styles.columns}>
            <TargetPicker targets={targets} selected={selected} onSelect={select} />

            <div className={styles.main}>
              {selected == null ? (
                <div className={styles.state}>
                  <p className={styles.stateText}>
                    Pick a target to see its analysis. Nothing runs until you ask for it — a full
                    session is minutes of work, so the sub count on each row is what you are
                    committing to.
                  </p>
                </div>
              ) : (
                <>
                  {status?.status === 'not_analysed' && (
                    <div className={styles.state}>
                      <p className={styles.stateText}>
                        No analysis yet for this target. That is the ordinary state of a fresh
                        archive, not a problem.
                      </p>
                      <button
                        type="button"
                        className={styles.action}
                        onClick={analyse}
                        disabled={starting}
                      >
                        {starting
                          ? 'Starting…'
                          : `Analyse ${selectedTarget?.sub_count ?? 0} subs`}
                      </button>
                    </div>
                  )}

                  {status?.status === 'running' && (
                    <div className={styles.state}>
                      <p className={styles.stateText}>
                        Analysing {selectedTarget?.sub_count ?? 0} subs — {status.elapsed_seconds}s
                        elapsed. This takes minutes on a real session; the page polls and will fill
                        in when it finishes.
                      </p>
                    </div>
                  )}

                  {status?.status === 'failed' && (
                    <div className={styles.state}>
                      <p className={styles.stateText}>
                        The analysis failed.{status.error ? ` ${status.error}` : ''}
                      </p>
                      <button
                        type="button"
                        className={styles.action}
                        onClick={analyse}
                        disabled={starting}
                      >
                        {starting ? 'Starting…' : 'Try again'}
                      </button>
                    </div>
                  )}

                  {report && finished && selectedTarget && (
                    <>
                      <ReportHeader
                        targetId={selectedTarget.target_id}
                        displayName={selectedTarget.display_name}
                        summary={report.summary}
                        analysedAt={finished.analysed_at}
                        stale={finished.status === 'stale'}
                      />

                      <div className={styles.card}>
                        <div className={styles.legend}>
                          <Swatch tone="pass" label="pass" />
                          <Swatch tone="marginal" label="marginal" />
                          <Swatch tone="reject" label="reject" />
                          <span className={styles.legendNote}>
                            coloured by the server&rsquo;s verdict — the payload carries no
                            thresholds, so no cutoff lines are drawn
                          </span>
                        </div>

                        <MetricChart
                          eyebrow="Per-sub eccentricity across the session"
                          subs={report.summary.subs}
                          metric="eccentricity"
                          totalSubs={report.summary.total}
                        />

                        <div className={styles.split}>
                          <MetricChart
                            eyebrow="Star count — cloud signal"
                            subs={report.summary.subs}
                            metric="star_count"
                            height={44}
                            totalSubs={report.summary.total}
                          />
                          <div className={styles.divider} />
                          <RejectionsByCause summary={report.summary} />
                        </div>
                      </div>

                      <SubTable subs={report.summary.subs} />
                    </>
                  )}
                </>
              )}

              {error && status?.status !== 'failed' && (
                <p className={styles.errorNote}>{error}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}

function Swatch({ tone, label }: { tone: 'pass' | 'marginal' | 'reject'; label: string }) {
  return (
    <span className={styles.swatchItem}>
      <span className={`${styles.swatch} ${styles[tone]}`} />
      {label}
    </span>
  )
}
