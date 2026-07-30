import type { Health, SiteProfile } from '../../api/schemas'
import { AppShell } from '../../shell/AppShell'
import { Sidebar } from '../../shell/Sidebar'
import { TopBar } from '../../shell/TopBar'
import type { View } from '../../shell/view'
import type { DotTone } from '../../ui/Dot'
import { Dot } from '../../ui/Dot'
import { GuardrailsCard } from './GuardrailsCard'
import { PreviewCard } from './PreviewCard'
import { SweetBandGauge } from './SweetBandGauge'
import { TargetHeader } from './TargetHeader'
import { TelemetryGrid } from './TelemetryGrid'
import { TelemetryLogCard } from './TelemetryLogCard'
import { useLiveSession } from './useLiveSession'
import styles from './LiveScreen.module.css'

export interface LiveScreenProps {
  view: View
  onNavigate: (view: View) => void
  site: SiteProfile | null
  health: Health | null
}

/** Sidebar dot tone/meta for the Live nav row — 'pass' while a session is
 * actually running (the one state that is genuinely "good news" the way
 * Tonight's GO verdict is), 'idle' while quietly not observing (the common
 * case, not a problem), 'reject' only when the bridge itself is
 * unreachable. Kept out of Sidebar itself, same pattern as Tonight's own
 * `verdict`/`verdictTone` — Sidebar stays presentational and does not need
 * to know this screen's phase shape. */
function sidebarStatus(phase: string): { tone: DotTone | null; meta: string | null } {
  if (phase === 'active') return { tone: 'pass', meta: 'live' }
  if (phase === 'bridge-down') return { tone: 'reject', meta: 'bridge down' }
  if (phase === 'idle') return { tone: 'idle', meta: 'idle' }
  return { tone: null, meta: null }
}

/**
 * Slice 3. Two columns, not the design's three (README.md Screen 2) — the
 * operator panel is deferred to its own slice and the whole button row
 * (`Refocus`/`Stop stack`/`Wind down & park`) is dropped outright, per the
 * decisions in docs/superpowers/specs/2026-07-30-slice-3-live-session.md §0:
 * the user does not want telescope control from this screen, only the
 * camera view and read-only status. Status indicators (the six-cell grid,
 * guardrails, sweet-band gauge, telemetry log) all stay — the distinction is
 * actionable-vs-informational, not which card something sits in.
 *
 * The idle state is the common case, not an edge case: a Seestar S50 spends
 * most of the day and a good chunk of the night not observing, and the
 * native state methods (`get_view_state`, `get_focuser_position`,
 * `list_subs`) are documented to time out exactly then — see
 * useLiveSession's own doc comment for how that is told apart from the
 * bridge actually being down, without parsing any error text.
 */
export function LiveScreen({ view, onNavigate, site, health }: LiveScreenProps) {
  const state = useLiveSession()
  const { tone: liveTone, meta: liveMeta } = sidebarStatus(state.phase)

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
          liveTone={liveTone}
          liveMeta={liveMeta}
        />
      }
    >
      <div className={styles.screen}>
        <div className={styles.header}>
          <div className={styles.eyebrow}>Live session</div>
          <h1 className={styles.heading}>Watch the current stack</h1>
        </div>

        {state.phase === 'loading' && (
          <div data-testid="live-loading">
            <div className={styles.skeleton} />
          </div>
        )}

        {state.phase === 'bridge-down' && (
          <div className={styles.stateCard} data-testid="live-bridge-down">
            <Dot tone="reject" />
            <div>
              <div className={styles.stateTitle}>Bridge unreachable</div>
              <p className={styles.stateBody}>{state.error}</p>
            </div>
          </div>
        )}

        {state.phase === 'idle' && (
          <div className={styles.stateCard} data-testid="live-idle">
            <Dot tone="idle" />
            <div>
              <div className={styles.stateTitle}>Scope idle — not observing</div>
              <p className={styles.stateBody}>
                The bridge answered, but `get_view_state` timed out, which means there is no
                active session right now rather than a fault. This is the normal state for most of
                the day, and most of the night.
              </p>
            </div>
          </div>
        )}

        {state.phase === 'active' && (
          <div className={styles.columns}>
            <PreviewCard
              preview={state.preview}
              annotate={state.viewState.result?.View?.Stack?.Annotate ?? null}
            />

            <div className={styles.center}>
              <TargetHeader
                targetName={state.viewState.result?.View?.target_name ?? null}
                stage={state.viewState.result?.View?.stage ?? null}
              />

              <TelemetryGrid
                stack={state.viewState.result?.View?.Stack ?? null}
                log={state.log}
                focuser={state.focuser}
                focuserBaseline={state.focuserBaseline}
                stage={state.viewState.result?.View?.stage ?? null}
                stageHistory={state.stageHistory}
              />

              {site?.profile ? (
                <div className={styles.row}>
                  <SweetBandGauge
                    rotationCeilingDeg={site.profile.field_rotation_ceiling_deg}
                    altitudeFloorDeg={site.profile.min_altitude_deg}
                    currentAltDeg={state.observability?.current_alt_deg ?? null}
                    currentAzDeg={state.observability?.current_az_deg ?? null}
                    minutesToBandExit={state.observability?.minutes_to_band_exit ?? null}
                  />
                  <GuardrailsCard guardrails={state.guardrails} />
                </div>
              ) : (
                <GuardrailsCard guardrails={state.guardrails} />
              )}

              <TelemetryLogCard log={state.log} />
            </div>
          </div>
        )}
      </div>
    </AppShell>
  )
}
