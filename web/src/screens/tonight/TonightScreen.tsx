import { useEffect, useState } from 'react'
import { fetchConditions, fetchPlan, fetchProjectsCombined, fetchQaTargets } from '../../api/client'
import type {
  Conditions,
  Health,
  PlanTargets,
  ProjectsCombinedEntry,
  QaVerdictCounts,
  SiteProfile,
} from '../../api/schemas'
import { verdictFor } from '../../api/verdict'
import { MOBILE_QUERY } from '../../shell/breakpoints'
import { MobileNav } from '../../shell/MobileNav'
import { Sidebar } from '../../shell/Sidebar'
import { TopBar } from '../../shell/TopBar'
import { AppShell } from '../../shell/AppShell'
import { useMediaQuery } from '../../shell/useMediaQuery'
import type { View } from '../../shell/view'
import { setPendingReviewTarget } from '../review/pendingTarget'
import { MobileTonightView } from './MobileTonightView'
import { PlanCard } from './PlanCard'
import { shortlistOrderLabel } from './shortlist'
import { SweetBandTimeline } from './SweetBandTimeline'
import { VerdictBanner } from './VerdictBanner'
import styles from './TonightScreen.module.css'

interface Data {
  conditions: Conditions
  plan: PlanTargets
}

/**
 * Is there anything for Review & QA to show for this target?
 *
 * `archive_minutes > 0` means the archive scan found subs on disk, and that
 * same scan is what `/api/qa_targets` builds the Review picker from — so this
 * is the picker's own membership test, not a proxy for it. `store_minutes`
 * deliberately does NOT count: a session logged by the server with no FITS
 * locally has nothing to score, and `useQaReview` would drop the handoff.
 *
 * An absent entry is `false` for the ordinary reason — the planner suggests
 * targets you have never shot, and most of a night's shortlist has no archive
 * at all.
 */
function canReview(entry: ProjectsCombinedEntry | undefined): boolean {
  return entry != null && entry.archive_minutes > 0
}

export interface TonightScreenProps {
  view: View
  onNavigate: (view: View) => void
  /** Shell-level data owned by App.tsx (useShellData) — fetched once, shared
   * across screens, so it survives a view switch instead of blanking and
   * re-fetching. See useShellData's docstring. */
  site: SiteProfile | null
  health: Health | null
}

export function TonightScreen({ view, onNavigate, site, health }: TonightScreenProps) {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Keyed by target_id — the ranked cards' own "time captured" progress bar
  // (see PlanCard's `progress` prop). Deliberately NOT part of `data`/the
  // load-gating Promise.all below: integration-goal context is an
  // enhancement to an already-useful screen (conditions + plan), not core to
  // it, so a failure here degrades every card to "no progress bar" instead
  // of taking down Tonight the way a conditions/plan failure does.
  const [progressById, setProgressById] = useState<Map<string, ProjectsCombinedEntry>>(new Map())
  // Keyed by target_id — the quality bar under each card's progress bar.
  // Same soft-fail contract as progressById: this is context on a screen that
  // is already useful without it, so a failure leaves the bars off rather
  // than taking Tonight down. Only targets with a COMPLETE analysis appear —
  // qa_targets attaches `verdicts` on nothing else — which is also why an
  // unanalysed target renders no bar instead of an empty one (an empty bar
  // reads as "nothing passed"; the truth is nobody measured).
  const [verdictsById, setVerdictsById] = useState<Map<string, QaVerdictCounts>>(new Map())

  // Same handoff the Projects grid's quality bar uses: park the target in
  // sessionStorage, then navigate. There is no router to carry it — see
  // pendingTarget.ts, which also explains why it is consumed once.
  const openQa = (targetId: string) => {
    setPendingReviewTarget(targetId)
    onNavigate('review')
  }

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchConditions(), fetchPlan(12)])
      .then(([conditions, plan]) => {
        if (!cancelled) setData({ conditions, plan })
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchProjectsCombined()
      .then((combined) => {
        if (cancelled) return
        setProgressById(new Map(combined.projects.map((p) => [p.target_id, p])))
      })
      .catch(() => {
        // Soft-fail by design — see the state's own doc comment above.
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetchQaTargets()
      .then((qa) => {
        if (cancelled) return
        setVerdictsById(
          new Map(
            qa.targets.flatMap((t) => (t.verdicts ? [[t.target_id, t.verdicts] as const] : [])),
          ),
        )
      })
      .catch(() => {
        // Soft-fail by design — see verdictsById's own doc comment above.
      })
    return () => {
      cancelled = true
    }
  }, [])

  const verdict = data ? verdictFor(data.conditions.go) : null
  const isMobile = useMediaQuery(MOBILE_QUERY)

  // Mobile — Tonight (design README.md:738-748) replaces the whole desktop
  // composition (VerdictBanner/SweetBandTimeline/PlanCard grid) with
  // MobileTonightView, and — like LiveScreen's own mobile branch — skips
  // AppShell entirely rather than squeezing Sidebar/TopBar chrome into a
  // phone-width viewport; see LiveScreen.tsx's doc comment for the full
  // reasoning, including why `MobileNav` (not Sidebar) is what threads
  // `view`/`onNavigate` here instead. The loading/error states have no
  // mobile design either, so they keep the exact same markup as the desktop
  // branch below, just outside AppShell.
  if (isMobile) {
    return (
      <div className={styles.mobileRoot}>
        <MobileNav view={view} onNavigate={onNavigate} />

        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        {!data && !error && (
          <div data-testid="tonight-loading">
            <div className={styles.skeleton} />
          </div>
        )}

        {data && <MobileTonightView conditions={data.conditions} targets={data.plan.targets} site={site} />}
      </div>
    )
  }

  return (
    <AppShell
      topBar={<TopBar site={site} replay={health?.replay ?? false} />}
      sidebar={
        <Sidebar
          site={site}
          verdict={verdict}
          gpsWarning={data?.conditions.location.warning ?? null}
          gpsMatched={data?.conditions.location.matched ?? null}
          view={view}
          onNavigate={onNavigate}
          // Tonight now fetches projects_combined too (for the ranked cards'
          // own progress bars, see progressById above), but deliberately
          // doesn't reuse it to populate the nav row's headline: that
          // aggregate is ProjectsScreen's own concern, and duplicating its
          // computation here risks the two headlines drifting apart.
          projectsHeadline={null}
        />
      }
    >
      <div className={styles.screen}>
        <div className={styles.header}>
          <div>
            <div className={styles.eyebrow}>Observing planner · assess_conditions</div>
            <h1 className={styles.heading}>
              {new Date().toLocaleDateString([], {
                weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
              })}
            </h1>
          </div>
          {data && <div className={styles.source}>source: {data.conditions.source}</div>}
        </div>

        {error && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        {!data && !error && (
          <div data-testid="tonight-loading">
            <div className={styles.skeleton} />
          </div>
        )}

        {data && (
          <>
            <VerdictBanner conditions={data.conditions} />
            {data.plan.targets.length > 0 ? (
              <>
                <SweetBandTimeline
                  conditions={data.conditions}
                  targets={data.plan.targets}
                />
                <div className={styles.shortlistHeader}>
                  <span className={styles.eyebrow}>plan_targets · ranked shortlist</span>
                  {/* plan_targets ranks on observability alone (astropy geometry,
                      altitude, moon separation) — a different question from the
                      sky judgment in assess_conditions — so the server genuinely
                      returns a ranked shortlist even on a no-go night. Showing it
                      is honest; this caption is what keeps it from reading as an
                      invitation to act, which the disabled hand-off buttons
                      already guard against structurally. It occupies the same
                      slot the order line would otherwise take rather than
                      stacking underneath it — a plan with a stated slew order
                      still reads as a plan, which a no-go night is not. */}
                  {verdict === 'NO-GO' ? (
                    <span className={styles.rankedCaption}>
                      Ranked for reference — tonight is a no-go.
                    </span>
                  ) : (
                    <span className={styles.order}>{shortlistOrderLabel(data.plan.targets)}</span>
                  )}
                </div>
                <div className={styles.grid}>
                  {data.plan.targets.map((target) => {
                    const entry = progressById.get(target.id)
                    return (
                      <PlanCard
                        key={target.id}
                        target={target}
                        progress={entry ? { totalMinutes: entry.total_minutes, goal: entry.goal } : null}
                        onOpenQa={canReview(entry) ? () => openQa(target.id) : undefined}
                        verdicts={verdictsById.get(target.id)}
                      />
                    )
                  })}
                </div>
              </>
            ) : (
              <div className={styles.empty}>
                No target clears the sweet band tonight. The ranker drops targets with
                zero clean sweet-band time; it does not report which — see
                docs/handback-to-seestar-ai.md item 4.
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  )
}
