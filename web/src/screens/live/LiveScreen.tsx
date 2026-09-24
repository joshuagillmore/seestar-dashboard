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
import { formatWhen } from './timestamps'
import {
  describeViewFailure,
  FAILED_POLLS_LIMIT,
  IDLE_DEVICE_CHECK_EVERY,
  POLL_INTERVAL_MS,
  useLiveSession,
  type LastSession,
  type LiveSessionState,
} from './useLiveSession'
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
function sidebarStatus(state: LiveSessionState): { tone: DotTone | null; meta: string | null } {
  const { phase } = state
  // A held reading is not a live one: not the green dot.
  if (phase === 'active' && state.stale !== null) return { tone: 'marginal', meta: 'stale' }
  if (phase === 'active') return { tone: 'pass', meta: 'live' }
  if (phase === 'bridge-down') return { tone: 'reject', meta: 'bridge down' }
  // A get_view_state request that got no answer is not the scope saying
  // it is idle.
  if (phase === 'idle' && state.viewError?.kind === 'no-answer') return { tone: 'marginal', meta: 'no reading' }
  if (phase === 'idle') return { tone: 'idle', meta: 'idle' }
  // Neither is idle, and neither is a fault of the bridge: the scope is
  // answering, but not in a way this screen can show as a session.
  if (phase === 'run-without-view') return { tone: 'marginal', meta: 'run, no view' }
  if (phase === 'unrecognised') return { tone: 'marginal', meta: 'unrecognised' }
  return { tone: null, meta: null }
}

/** "Last session ended: M1 · 1003 stacked · 0 dropped". A count the scope
 * did not report is left out rather than shown as zero, and "ended" is said
 * only when the View's own state says so. */
function lastSessionLine({ target, stacked, dropped, ended }: LastSession): string {
  const parts = [target]
  if (stacked !== null) parts.push(`${stacked} stacked`)
  if (dropped !== null) parts.push(`${dropped} dropped`)
  return ended
    ? `Last session ended: ${parts.join(' · ')}`
    : `Scope reports ${parts.join(' · ')}, but is not observing`
}

/**
 * Shown over an active session whose reading is held from an earlier poll
 * because the latest could not read the scope (see `stale` on
 * useLiveSession's active state). Says what failed, how many polls in a row
 * have, and how old the reading is, so a held stack count cannot pass for a
 * current one. Not an alert: a failed poll is expected now and then.
 *
 * Every claim here holds in every state it appears in. It appears only for
 * fewer than FAILED_POLLS_LIMIT failed polls in a row, and while it does the
 * device is asked on every poll (useLiveSession's holdingSession), so "the
 * next poll asks again" is true; past the limit the failure card replaces it.
 */
function StaleNotice({ reason, failedPolls, readAt }: { reason: string; failedPolls: number; readAt: string }) {
  const when = formatWhen(readAt)
  const which = failedPolls === 1 ? 'This poll' : `The last ${failedPolls} polls`
  return (
    <div className={styles.staleNotice} role="status" data-testid="live-stale">
      <Dot tone="marginal" />
      <p className={styles.staleText}>
        <span className={styles.staleTitle}>Not current.</span> {which} could not read the scope
        {failedPolls === 1 ? '' : '; the latest'}: {reason}. Showing the last reading
        {when ? `, from ${when}` : ''}. The session is held here for up to {FAILED_POLLS_LIMIT - 1} failed
        polls in a row, and the next poll asks again.
      </p>
    </div>
  )
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
 * when there's no live camera to show. `sessionRunning={false}` on the idle
 * card is what keeps that honest — the feed's own timestamps already say
 * when each entry is from, but the card adds a plain-language note too, so a
 * three-nights-old entry can't read as something happening right now.
 * Bridge-down passes `null` instead (or `true` when get_run_state reports an
 * active run): with the scope unreachable, "no session is running" is a
 * claim this client cannot make.
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
  const { tone: liveTone, meta: liveMeta } = sidebarStatus(state)

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
          {/* Only a session actually running has a current stack to watch.
              Everywhere else this heading sat over a card saying there was
              none, and on a parked scope it read as confirming a live one. */}
          <h1 className={styles.heading}>
            {state.phase === 'active' ? 'Watch the current stack' : 'Scope status'}
          </h1>
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
              {state.runActive && (
                <p className={styles.stateBody}>
                  get_run_state still reports an active run{state.runTarget ? ` on ${state.runTarget}` : ''}. It
                  may be carrying on without this screen.
                </p>
              )}
            </div>
          </div>
          {/* The scope cannot be asked, so this client cannot know whether a
              session is running: no claim, unless run_state says one is. */}
          <SessionActivityCard
            activity={state.sessionActivity}
            sessionRunning={state.runActive ? true : null}
            wide
          />
        </div>
      )}

      {state.phase === 'idle' && state.viewError?.kind !== 'no-answer' && (
        <div className={styles.idleColumns}>
          <div className={styles.stateCard} data-testid="live-idle">
            <Dot tone="idle" />
            <div>
              <div className={styles.stateTitle}>Scope idle — not observing</div>
              <p className={styles.stateBody}>
                {/* "No session in progress", not "no view session": a parked
                    scope answers with its ended View, which is a view
                    session, just not a running one. */}
                {state.viewError === null
                  ? 'The scope answered and reports no session in progress, so nothing is being observed right now.'
                  : `The bridge answered, but ${describeViewFailure(state.viewError)}, which on this scope means no active session rather than a fault.`}{' '}
                This is the normal state for most of the day, and most of the night.
              </p>
              {/* A parked scope keeps its ended session's View, final counts
                  and all. Said as what finished, so it cannot read as a
                  stack in progress. */}
              {state.lastSession !== null && (
                <p className={styles.stateBody} data-testid="live-idle-last-session">
                  {lastSessionLine(state.lastSession)}
                </p>
              )}
            </div>
          </div>
          <SessionActivityCard activity={state.sessionActivity} sessionRunning={false} wide />
        </div>
      )}

      {/* The request for get_view_state got no answer at all. get_status
          answered, so the bridge is up, but the scope has said nothing
          either way: not "idle", and not the sidecar advice the client's
          own message carries, which get_status answering disproves. */}
      {state.phase === 'idle' && state.viewError?.kind === 'no-answer' && (
        <div className={styles.idleColumns}>
          <div className={styles.stateCard} data-testid="live-idle">
            <Dot tone="marginal" />
            <div>
              <div className={styles.stateTitle}>No reading from the scope</div>
              <p className={styles.stateBody}>
                When last asked, get_status answered, so the bridge is up, but{' '}
                {describeViewFailure(state.viewError)}. That is the request failing, not the scope
                reporting, so this screen cannot say whether anything is being observed. The idle
                back-off can skip the scope on the polls in between, but it is asked again within the
                next {IDLE_DEVICE_CHECK_EVERY} polls ({POLL_INTERVAL_MS / 1000} s apart).
              </p>
            </div>
          </div>
          <SessionActivityCard activity={state.sessionActivity} sessionRunning={null} wide />
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
                  ? 'the scope reports no session in progress'
                  : describeViewFailure(state.viewError)}{' '}
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
        const staleNotice =
          state.stale === null ? null : (
            <StaleNotice reason={state.stale.reason} failedPolls={state.stale.failedPolls} readAt={state.readAt} />
          )

        if (isMobile) {
          return (
            <>
              {staleNotice}
              <MobileLiveView
                targetId={state.observability?.target?.id ?? state.currentTarget}
                targetName={state.observability?.target?.name ?? null}
                stack={liveView?.Stack ?? null}
                tier1={state.tier1}
                focuser={state.focuser}
                preview={state.preview}
                log={state.log}
              />
            </>
          )
        }

        const targetName =
          state.observability?.target?.name ?? liveView?.target_name ?? state.currentTarget
        return (
          <>
            {staleNotice}
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

              {/* A held reading cannot say whether the session is still
                  running, so the feed makes no claim either way. */}
              <SessionActivityCard
                activity={state.sessionActivity}
                sessionRunning={state.stale === null ? true : null}
              />
            </div>
          </>
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
