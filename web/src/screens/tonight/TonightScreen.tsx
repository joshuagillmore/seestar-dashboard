import { useEffect, useState } from 'react'
import { fetchConditions, fetchPlan, fetchProjectsCombined } from '../../api/client'
import type { Conditions, Health, PlanTargets, ProjectsCombinedEntry, SiteProfile } from '../../api/schemas'
import { verdictFor } from '../../api/verdict'
import { Sidebar } from '../../shell/Sidebar'
import { TopBar } from '../../shell/TopBar'
import { AppShell } from '../../shell/AppShell'
import type { View } from '../../shell/view'
import { PlanCard } from './PlanCard'
import { shortlistOrderLabel } from './shortlist'
import { SweetBandTimeline } from './SweetBandTimeline'
import { VerdictBanner } from './VerdictBanner'
import styles from './TonightScreen.module.css'

interface Data {
  conditions: Conditions
  plan: PlanTargets
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

  const verdict = data ? verdictFor(data.conditions.go) : null

  return (
    <AppShell
      topBar={<TopBar site={site} replay={health?.replay ?? false} />}
      sidebar={
        <Sidebar
          site={site}
          verdict={verdict}
          gpsWarning={data?.conditions.location.warning ?? null}
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
