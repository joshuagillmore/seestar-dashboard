import { useEffect, useState } from 'react'
import { fetchConditions, fetchHealth, fetchPlan, fetchSite } from '../../api/client'
import type { Conditions, Health, PlanTargets, SiteProfile } from '../../api/schemas'
import { verdictFor } from '../../api/verdict'
import { Sidebar } from '../../shell/Sidebar'
import { TopBar } from '../../shell/TopBar'
import { AppShell } from '../../shell/AppShell'
import { PlanCard } from './PlanCard'
import { SweetBandTimeline } from './SweetBandTimeline'
import { VerdictBanner } from './VerdictBanner'
import styles from './TonightScreen.module.css'

interface Data {
  conditions: Conditions
  plan: PlanTargets
  site: SiteProfile
  health: Health
}

export function TonightScreen() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchConditions(), fetchPlan(3), fetchSite(), fetchHealth()])
      .then(([conditions, plan, site, health]) => {
        if (!cancelled) setData({ conditions, plan, site, health })
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const verdict = data ? verdictFor(data.conditions.go) : null

  return (
    <AppShell
      topBar={<TopBar site={data?.site ?? null} replay={data?.health.replay ?? false} />}
      sidebar={
        <Sidebar
          site={data?.site ?? null}
          verdict={verdict}
          gpsWarning={data?.conditions.location.warning ?? null}
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
                {/* plan_targets ranks on observability alone (astropy geometry,
                    altitude, moon separation) — a different question from the
                    sky judgment in assess_conditions — so the server genuinely
                    returns a ranked shortlist even on a no-go night. Showing it
                    is honest; this caption is what keeps it from reading as an
                    invitation to act, which the disabled hand-off buttons
                    already guard against structurally. */}
                {verdict === 'NO-GO' && (
                  <div className={styles.rankedCaption}>
                    Ranked for reference — tonight is a no-go.
                  </div>
                )}
                <div className={styles.grid}>
                  {data.plan.targets.map((target) => (
                    <PlanCard key={target.id} target={target} />
                  ))}
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
