import { useState } from 'react'
import type { Health, SiteProfile } from '../../api/schemas'
import { AppShell } from '../../shell/AppShell'
import { MOBILE_QUERY } from '../../shell/breakpoints'
import { MobileNav } from '../../shell/MobileNav'
import { useMediaQuery } from '../../shell/useMediaQuery'
import { MobileReviewView } from './MobileReviewView'
import { Sidebar } from '../../shell/Sidebar'
import { TopBar } from '../../shell/TopBar'
import type { View } from '../../shell/view'
import { MetricChart } from './MetricChart'
import { RejectionsByCause } from './RejectionsByCause'
import { ReportHeader } from './ReportHeader'
import { SubTable } from './SubTable'
import { TargetPicker } from './TargetPicker'
import { thresholdLinesFor, toneFor, type QaTone } from './qa'
import { AnalysisState, ErrorNote, StaleNotice } from './ReviewStates'
import { errorNoteText, hasReport } from './statusHelpers'
import { SubImageCard } from './SubImageCard'
import { useQaReview } from './useQaReview'
import styles from './ReviewScreen.module.css'

export interface ReviewScreenProps {
  view: View
  onNavigate: (view: View) => void
  site: SiteProfile | null
  health: Health | null
}

/** The three the policy defines, in severity order. `unknown` is not offered
 * as a filter: it exists so an unrecognised verdict still RENDERS, and hiding
 * one behind a chip nobody thinks to click would defeat that. Such a sub
 * always shows. */
const FILTERS: ReadonlyArray<{ tone: QaTone; label: string }> = [
  { tone: 'reject', label: 'REJECT' },
  { tone: 'marginal', label: 'MARGINAL' },
  { tone: 'pass', label: 'PASS' },
]

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
 * ## The threshold lines — asked for, and now drawn
 *
 * The design specifies dashed cutoff lines and says, correctly, "these are
 * computed, not constants — never hardcode them in the client. Ship them in
 * the report payload." They were not in the payload: the cutoffs existed only
 * as prose inside `reasons[]`, and parsing them back out to position a line
 * would have been re-deriving a verdict. So this screen shipped with no lines
 * and a legend saying why, and the gap went back to seestar-mcp instead.
 *
 * They shipped `summary.thresholds` (d555c4b) — the *effective* cutoffs the
 * session was actually scored against, not the config constants. The lines
 * are now drawn from that field. They are still session-relative: `snr_floor`
 * is half this session's median SNR, so a line from one night's report means
 * nothing on another's. `.optional()` on the schema means a report cached
 * before d555c4b still renders, just without lines.
 *
 * ## Two things from the design that remain deliberately absent
 *
 * Each is a missing data source, not unfinished work, and each ships an
 * honest gap rather than a plausible-looking placeholder:
 *
 * 1. **The pattern callout.** The design's highest-value element — one
 *    sentence explaining *why* frames failed — and it says explicitly that it
 *    "should come from the agent, not a template". There is no agent output
 *    channel in this repo, and writing the template it warns against would be
 *    worse than leaving the space empty.
 *
 * 2. **The master image card and the seestar-refine actions.** Both are write
 *    paths: `stack_keep_list`, `stretch_master` and the PixInsight handoff
 *    have no route by design, and post-processing has since left the MCP
 *    surface entirely. The design says to disable buttons whose backend is
 *    missing — but ours are missing permanently and structurally, so three
 *    dead buttons would imply a capability that is never coming. A line of
 *    text is the honest version.
 */
export function ReviewScreen({ view, onNavigate, site, health }: ReviewScreenProps) {
  const { phase, targets, selected, status, starting, error, select, analyse } = useQaReview()
  // Empty = no filter, show everything. Not "all three selected", so the
  // default state cannot be confused with a filter that happens to include
  // everything.
  const [hidden, setHidden] = useState<ReadonlySet<QaTone>>(new Set())
  // The open sub, by NAME, with the target it belongs to — looked up in the
  // CURRENT report on every render.
  //
  // Keyed by target because holding the sub alone let it outlive a target
  // change: the card paired the new target's id with the old target's sub.
  // Keyed by name, not by the sub object, because the object is a snapshot:
  // after a re-analyse the card kept the OLD verdict and reasons beside the
  // new rows. A name the new report no longer has simply renders nothing.
  const [openSub, setOpenSub] = useState<{ targetId: string; name: string } | null>(null)
  const isMobile = useMediaQuery(MOBILE_QUERY)

  const selectedTarget = targets?.targets.find((t) => t.target_id === selected) ?? null
  const subCount = selectedTarget?.sub_count ?? 0
  // Narrowed once, here, so the render below never has to re-test the union.
  // `stale` carries a real report and must keep rendering one — it is a
  // usable result with a caveat, not an absent one.
  const finished =
    status != null && (status.status === 'complete' || status.status === 'stale') ? status : null
  const report = hasReport(status) ? finished?.report : undefined
  const stale = finished?.status === 'stale'
  const note = errorNoteText(error, status)

  // One description of the non-report states, for both layouts — see
  // ReviewStates.tsx for why they are no longer written twice.
  const analysisState = (compact: boolean) => (
    <AnalysisState
      selected={selected}
      status={status}
      error={error}
      starting={starting}
      subCount={subCount}
      onAnalyse={analyse}
      onReload={() => {
        if (selected != null) select(selected)
      }}
      compact={compact}
    />
  )
  const staleNotice = <StaleNotice subCount={subCount} starting={starting} onAnalyse={analyse} />

  // Mobile — not in the design handoff (phone frames were specified for
  // Tonight and Live only), so this is an extension. Same shape as those two:
  // skip AppShell entirely rather than squeezing a 300px target picker and a
  // seven-column table into a phone viewport, and use MobileNav to stay
  // reachable. See MobileReviewView for what it drops and why.
  if (isMobile) {
    return (
      <div className={styles.mobileRoot}>
        <MobileNav view={view} onNavigate={onNavigate} />
        {phase === 'loading' && <div className={styles.skeleton} />}
        {phase === 'error' && (
          <div className={styles.state}>
            <p className={styles.stateText}>
              Could not read the archive listing.{error ? ` ${error}` : ''}
            </p>
          </div>
        )}
        {phase === 'ready' && targets && (
          <MobileReviewView
            targets={targets.targets}
            selected={selected}
            onSelect={select}
            summary={report?.summary ?? null}
            displayName={selectedTarget?.display_name ?? null}
            state={analysisState(true)}
            analysedAt={finished?.analysed_at ?? null}
            stale={stale}
            staleNotice={stale ? staleNotice : null}
            errorNote={note}
          />
        )}
      </div>
    )
  }

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
              {!(report && finished && selectedTarget) && (
                <div className={styles.state}>{analysisState(false)}</div>
              )}

              {report && finished && selectedTarget && (
                <>
                  <ReportHeader
                    targetId={selectedTarget.target_id}
                    displayName={selectedTarget.display_name}
                    summary={report.summary}
                    analysedAt={finished.analysed_at}
                    stale={stale}
                  />

                  {stale && staleNotice}

                  <div className={styles.card}>
                    <div className={styles.legend}>
                      <Swatch tone="pass" label="pass" />
                      <Swatch tone="marginal" label="marginal" />
                      <Swatch tone="reject" label="reject" />
                      <span className={styles.legendNote}>
                        each bar is the worst sub in its slice, toned by the verdict the
                        server&rsquo;s reasons give that metric; dashed lines are the
                        cutoffs this session was scored against — session-relative, so
                        another night&rsquo;s are different numbers
                      </span>
                    </div>

                    <MetricChart
                      eyebrow="Per-sub eccentricity across the session"
                      subs={report.summary.subs}
                      metric="eccentricity"
                      totalSubs={report.summary.total}
                      thresholds={thresholdLinesFor('eccentricity', report.summary.thresholds)}
                    />

                    <div className={styles.split}>
                      <MetricChart
                        eyebrow="Star count — cloud signal"
                        subs={report.summary.subs}
                        metric="star_count"
                        height={44}
                        totalSubs={report.summary.total}
                        thresholds={thresholdLinesFor('star_count', report.summary.thresholds)}
                      />
                      <div className={styles.divider} />
                      <RejectionsByCause summary={report.summary} />
                    </div>
                  </div>

                  {(() => {
                    // Filtering applies to the TABLE only. The charts show
                    // the session's distribution and filtering them would
                    // misrepresent it — a chart of only the rejects is not
                    // a picture of the night.
                    const visible = report.summary.subs.filter((s) => {
                      const tone = toneFor(s.verdict)
                      // An unrecognised verdict is never hidden — see FILTERS.
                      return !FILTERS.some((f) => f.tone === tone) || !hidden.has(tone)
                    })
                    const countFor = (tone: QaTone) =>
                      report.summary.subs.filter((s) => toneFor(s.verdict) === tone).length
                    const openName =
                      openSub?.targetId === selectedTarget.target_id ? openSub.name : null
                    const open =
                      openName == null
                        ? undefined
                        : report.summary.subs.find((s) => s.name === openName)

                    return (
                      <>
                        <div className={styles.filterBar}>
                          <span className={styles.filterLabel}>Show</span>
                          {FILTERS.map(({ tone, label }) => {
                            const on = !hidden.has(tone)
                            return (
                              <button
                                key={tone}
                                type="button"
                                aria-pressed={on}
                                className={`${styles.chip} ${styles[tone]} ${on ? styles.chipOn : ''}`}
                                onClick={() =>
                                  setHidden((prev) => {
                                    const next = new Set(prev)
                                    if (next.has(tone)) next.delete(tone)
                                    else next.add(tone)
                                    return next
                                  })
                                }
                              >
                                {label} <span className={styles.chipCount}>{countFor(tone)}</span>
                              </button>
                            )
                          })}
                        </div>

                        {open && (
                          <SubImageCard
                            targetId={selectedTarget.target_id}
                            sub={open}
                            onClose={() => setOpenSub(null)}
                          />
                        )}

                        <SubTable
                          subs={visible}
                          totalUnfiltered={report.summary.subs.length}
                          onSelect={(sub) =>
                            setOpenSub({ targetId: selectedTarget.target_id, name: sub.name })
                          }
                          selectedName={open ? open.name : null}
                        />
                      </>
                    )
                  })()}
                </>
              )}

              {note && <ErrorNote text={note} />}
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
