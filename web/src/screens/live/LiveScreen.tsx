import type { Health, SiteProfile } from '../../api/schemas'
import { AppShell } from '../../shell/AppShell'
import { Sidebar } from '../../shell/Sidebar'
import { TopBar } from '../../shell/TopBar'
import type { View } from '../../shell/view'
import type { DotTone } from '../../ui/Dot'
import { Dot } from '../../ui/Dot'
import { GuardrailsCard } from './GuardrailsCard'
import { PreviewCard } from './PreviewCard'
import { SessionActivityCard } from './SessionActivityCard'
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
 * Slice 3. Three columns, matching the design (README.md Screen 2): preview
 * `286px` / centre `flex: 1` / session activity `336px`. The whole button
 * row (`Refocus`/`Stop stack`/`Wind down & park`) and the approval gate are
 * still dropped outright, per docs/superpowers/specs/2026-07-30-slice-3-
 * live-session.md §0: the user does not want telescope control from this
 * screen, only the camera view and read-only status. Status indicators
 * (the six-cell grid, guardrails, sweet-band gauge, telemetry log) all
 * stay — the distinction is actionable-vs-informational, not which card
 * something sits in.
 *
 * The third column was briefly built as two columns with the operator panel
 * deferred entirely, then reinstated at the user's request ("keep a
 * placeholder column… if we can have the claude output in that column with
 * no interactivity, that's an option") — collapsing it would have baked in
 * a decision that was only ever deferred. It is `SessionActivityCard`, not
 * the design's chat transcript: `/api/session_activity` is a plain
 * `{ts, tool, args, origin}` feed off `provenance.jsonl`, with no prose to
 * build message bubbles from — see that component's own doc comment for why
 * it is headed "Session activity", never "Claude".
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

        {state.phase === 'active' && (() => {
          // get_view_state carries no target name at all (confirmed against
          // the real fixture) — observability's own target.name is the
          // richest source once it resolves; the catalogue id useLiveSession
          // sourced from live_preview's `target` field is the bootstrap
          // value shown before that.
          const view = state.viewState.view_state?.result?.View ?? null
          const targetName = state.observability?.target?.name ?? state.currentTarget
          return (
            <div className={styles.columns}>
              <PreviewCard preview={state.preview} annotate={view?.Stack?.Annotate ?? null} />

              <div className={styles.center}>
                <TargetHeader targetName={targetName} stage={view?.stage ?? null} />

                <TelemetryGrid
                  stack={view?.Stack ?? null}
                  tier1={state.tier1}
                  focuser={state.focuser}
                  stage={view?.stage ?? null}
                  stageHistory={state.stageHistory}
                />

                {site?.profile ? (
                  <div className={styles.row}>
                    <SweetBandGauge
                      rotationCeilingDeg={site.profile.field_rotation_ceiling_deg}
                      altitudeFloorDeg={site.profile.min_altitude_deg}
                      observability={state.observability?.observability ?? null}
                    />
                    <GuardrailsCard guardrails={state.guardrails} />
                  </div>
                ) : (
                  <GuardrailsCard guardrails={state.guardrails} />
                )}

                <TelemetryLogCard log={state.log} />
              </div>

              <SessionActivityCard activity={state.sessionActivity} />
            </div>
          )
        })()}
      </div>
    </AppShell>
  )
}
