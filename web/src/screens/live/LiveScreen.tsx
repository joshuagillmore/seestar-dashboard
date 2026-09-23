import type { Health, SiteProfile } from '../../api/schemas'
import { AppShell } from '../../shell/AppShell'
import { MOBILE_QUERY } from '../../shell/breakpoints'
import { MobileNav } from '../../shell/MobileNav'
import { Sidebar } from '../../shell/Sidebar'
import { TopBar } from '../../shell/TopBar'
import { useMediaQuery } from '../../shell/useMediaQuery'
import type { View } from '../../shell/view'
import type { DotTone } from '../../ui/Dot'
import { Dot } from '../../ui/Dot'
import { GuardrailsCard } from './GuardrailsCard'
import { LastStackCard } from './LastStackCard'
import { MobileLiveView } from './MobileLiveView'
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
  // Neither is idle, and neither is a fault of the bridge: the scope is
  // answering, but not in a way this screen can show as a session.
  if (phase === 'run-without-view') return { tone: 'marginal', meta: 'run, no view' }
  if (phase === 'unrecognised') return { tone: 'marginal', meta: 'unrecognised' }
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
 * The preview column (`.previewColumn`) is two cards stacked, not one, as of
 * handback item 23's workaround: `PreviewCard` (the live 10 s sub) above
 * `LastStackCard` (the previous session's dated stacked master for the same
 * target, since the scope only ever writes that file at session end — see
 * LastStackCard's own doc comment for the whole honesty rule this carries).
 * Desktop only — the mobile phone-frame design (README.md:724-737) has no
 * second preview element, and MobileLiveView already drops several things
 * for the same "not in that spec" reason, so this doesn't add one there
 * either.
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
 *
 * Idle and bridge-down both pair their state card with the activity feed,
 * widened (`wide`) since it is the main content then rather than a fixed
 * sidebar — the user's own reasoning: "most of the time this screen is
 * open, no session is running," and the feed answers what actually happened
 * while nobody was watching, which is the more useful question exactly
 * when there's no live camera to show. `sessionRunning={false}` on the card
 * is what keeps that honest — the feed's own timestamps already say when
 * each entry is from, but the card adds a plain-language note too, so a
 * three-nights-old entry can't read as something happening right now.
 *
 * **Mobile breakpoint** (slice added later, design README.md:711-737): below
 * `MOBILE_QUERY` (600px), this screen skips `AppShell` entirely rather than
 * squeezing Sidebar/TopBar next to narrowed content — the design's own phone
 * frame shows zero chrome, just the screen content padded `8px 16px 0` on
 * `bg/root` (`.mobileRoot` below). `MobileLiveView` replaces the desktop
 * three-column composition only for the `'active'` phase, which is the only
 * one the design actually specifies; `loading`/`bridge-down`/`idle` render
 * their ordinary desktop markup unchanged, just full-width.
 *
 * Dropping AppShell also drops the only thing that ever called `onNavigate`
 * (Sidebar) — the design's phone frames show both mobile screens at once in
 * one static mockup, so it never had to answer how a phone user moves
 * between them. `MobileNav` is this repo's own answer, not a design spec: one
 * target per view at the 44px minimum, so no mobile screen is unreachable —
 * see its own doc comment, including why it carried only two for a while and
 * why that turned out to be a bug. This is a design divergence worth
 * tracking, not a gap to leave silent.
 */
export function LiveScreen({ view, onNavigate, site, health }: LiveScreenProps) {
  const state = useLiveSession()
  const isMobile = useMediaQuery(MOBILE_QUERY)
  const { tone: liveTone, meta: liveMeta } = sidebarStatus(state.phase)

  // Mobile — Live (design README.md:724-737) only has a dedicated
  // composition for the 'active' phase — there's no mobile design for
  // loading/idle/bridge-down at all, so those three keep the exact desktop
  // markup below (LiveScreen.module.css's own `.idleColumns`/`.stateCard`),
  // just rendered full-width outside AppShell rather than squeezed beside a
  // hidden sidebar. See this component's own doc comment addendum below for
  // why AppShell (Sidebar/TopBar chrome) is skipped entirely at this
  // breakpoint rather than made responsive itself.
  const mobileActive = isMobile && state.phase === 'active'

  const content = (
    <div className={styles.screen}>
      {!mobileActive && (
        <div className={styles.header}>
          <div className={styles.eyebrow}>Live session</div>
          <h1 className={styles.heading}>Watch the current stack</h1>
        </div>
      )}

      {state.phase === 'loading' && (
        <div data-testid="live-loading">
          <div className={styles.skeleton} />
        </div>
      )}

      {state.phase === 'bridge-down' && (
        <div className={styles.idleColumns}>
          <div className={styles.stateCard} data-testid="live-bridge-down">
            <Dot tone="reject" />
            <div>
              <div className={styles.stateTitle}>Bridge unreachable</div>
              <p className={styles.stateBody}>{state.error}</p>
            </div>
          </div>
          <SessionActivityCard activity={state.sessionActivity} sessionRunning={false} wide />
        </div>
      )}

      {state.phase === 'idle' && (
        <div className={styles.idleColumns}>
          <div className={styles.stateCard} data-testid="live-idle">
            <Dot tone="idle" />
            <div>
              <div className={styles.stateTitle}>Scope idle — not observing</div>
              <p className={styles.stateBody}>
                {state.viewError === null
                  ? 'The scope answered and reports no view session, so nothing is being observed right now.'
                  : `The bridge answered, but get_view_state did not (${state.viewError}), which on this scope means no active session rather than a fault.`}{' '}
                This is the normal state for most of the day, and most of the night.
              </p>
            </div>
          </div>
          <SessionActivityCard activity={state.sessionActivity} sessionRunning={false} wide />
        </div>
      )}

      {state.phase === 'run-without-view' && (
        <div className={styles.idleColumns}>
          <div className={styles.stateCard} data-testid="live-run-without-view">
            <Dot tone="marginal" />
            <div>
              <div className={styles.stateTitle}>Run in progress — no live view</div>
              <p className={styles.stateBody}>
                get_run_state reports an active run{state.runTarget ? ` on ${state.runTarget}` : ''}, but{' '}
                {state.viewError === null
                  ? 'the scope reports no view session'
                  : `get_view_state did not answer (${state.viewError})`}{' '}
                this poll. That is not shown as idle: the run may be between targets, or its view may
                have stopped.
              </p>
            </div>
          </div>
          <SessionActivityCard activity={state.sessionActivity} sessionRunning={true} wide />
        </div>
      )}

      {state.phase === 'unrecognised' && (
        <div className={styles.idleColumns}>
          <div className={styles.stateCard} data-testid="live-unrecognised">
            <Dot tone="marginal" />
            <div>
              <div className={styles.stateTitle}>Telescope state unreadable</div>
              <p className={styles.stateBody}>
                The telescope answered in a shape this dashboard doesn&apos;t understand, so it cannot
                tell whether a session is running — and will not guess idle.
              </p>
              <p className={styles.stateDetail} data-testid="live-unrecognised-detail">
                {state.detail}
              </p>
            </div>
          </div>
          <SessionActivityCard activity={state.sessionActivity} sessionRunning={null} wide />
        </div>
      )}

      {state.phase === 'active' && (() => {
        // get_view_state's View block DOES carry a target_name (confirmed on
        // hardware 2026-07-31 — see ViewSchema's own doc comment), but it is
        // a catalogue id ("NGC7380"), not a resolved common name —
        // observability's own target.name ("Wizard Nebula") is still the
        // richest source once it resolves. view.target_name sits ahead of
        // the bootstrap value useLiveSession sourced from live_preview's
        // `target` field (currentTarget), since it comes from the scope's
        // own live telemetry rather than a directory-name parse.
        const liveView = state.viewState.view_state?.result?.View ?? null

        if (isMobile) {
          return (
            <MobileLiveView
              targetId={state.observability?.target?.id ?? state.currentTarget}
              targetName={state.observability?.target?.name ?? null}
              stack={liveView?.Stack ?? null}
              tier1={state.tier1}
              focuser={state.focuser}
              preview={state.preview}
              log={state.log}
            />
          )
        }

        const targetName =
          state.observability?.target?.name ?? liveView?.target_name ?? state.currentTarget
        return (
          <div className={styles.columns}>
            <div className={styles.previewColumn}>
              <PreviewCard
                preview={state.preview}
                annotate={liveView?.Stack?.Annotate ?? null}
                exposureMs={liveView?.Stack?.Exposure?.exp_ms ?? null}
                targetName={liveView?.target_name ?? null}
              />
              <LastStackCard lastStack={state.lastStack} />
            </div>

            <div className={styles.center}>
              <TargetHeader
                targetName={targetName}
                stage={liveView?.stage ?? null}
                lpFilter={liveView?.lp_filter}
                sessionStartUtc={state.sessionStartUtc}
              />

              <TelemetryGrid
                stack={liveView?.Stack ?? null}
                tier1={state.tier1}
                focuser={state.focuser}
                stage={liveView?.stage ?? null}
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

            <SessionActivityCard activity={state.sessionActivity} sessionRunning={true} />
          </div>
        )
      })()}
    </div>
  )

  if (isMobile) {
    return (
      <div className={styles.mobileRoot}>
        <MobileNav view={view} onNavigate={onNavigate} />
        {content}
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
          liveTone={liveTone}
          liveMeta={liveMeta}
        />
      }
    >
      {content}
    </AppShell>
  )
}
