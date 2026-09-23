import type { SessionActivity, SessionActivityRecord } from '../../api/schemas'
import { localHhMm, parse } from '../tonight/timeline'
import styles from './SessionActivityCard.module.css'

export interface SessionActivityCardProps {
  /** `null` covers "not fetched yet", "the route isn't deployed yet" and
   * "the fetch failed" — all render the same honest not-available state.
   * This is deliberately never gated on the telescope's own state the way
   * the rest of the centre column is; provenance.jsonl is a local file this
   * sidecar can read regardless of whether the scope is observing. */
  activity: SessionActivity | null
  /** Whether a telescope session is actually running right now — `true`
   * only in the `active` phase. Required, not defaulted: this is the field
   * that keeps the feed from misrepresenting itself. The log refreshes on
   * every poll regardless of phase, so a busy-looking list of timestamped
   * entries from three nights ago could otherwise read as "something is
   * happening now" — the one thing this card must never imply when nothing
   * is. `false` adds a visible note; it never hides or reorders the feed.
   * `null` is "cannot tell" (the scope answered unreadably): no note, since
   * "no session is running" would be a claim this client cannot make. */
  sessionRunning: boolean | null
  /** Widens the card to `flex: 1` instead of its default fixed `336px` —
   * used in the idle/bridge-down layout, where this feed is the main
   * content rather than a sidebar beside the preview/telemetry (see
   * LiveScreen.tsx). A dedicated boolean rather than an open `className`
   * passthrough: a generic class merged in from the caller would depend on
   * CSS source order between two different modules to win the cascade
   * against this component's own `.card` width — fragile in a way a prop
   * this component applies itself is not. */
  wide?: boolean
}

const ORIGIN_LABEL: Record<SessionActivityRecord['origin'], string> = {
  console: 'this console',
  agent: 'agent',
  ambiguous: 'unattributed',
  unknown: 'unknown',
}

/**
 * The design's operator panel (README.md:507-536) pictures a chat transcript
 * — Claude's own sentences in message bubbles, plus an approval gate. The
 * real `/api/session_activity` is neither of those things: it is a plain,
 * newest-first activity feed off `provenance.jsonl`, and every record is
 * exactly `{ts, tool, args}` plus a classification this sidecar computes.
 * There is no prose field anywhere in that file, so this card never
 * authors a sentence from a tool call ("Claude just checked guardrails") —
 * that would be exactly the kind of invented assessment this project
 * avoids everywhere else (VerdictBanner's headline, the QA verdict, the
 * guardrails card). It renders what the log actually is: who (probably)
 * did what, when.
 *
 * `origin` is the field that must never be flattened or hidden. Hand-back
 * item 10 has landed, so it is now a real attribution: every record carries
 * the `client` that wrote it, this console names itself, and a record reads
 * `this console`, `agent`, `unattributed` (written before the field existed)
 * or `unknown` (didn't parse). The column is still headed "Session
 * activity", never "Claude" — `unattributed` must never be presented as the
 * agent's, and every record carries its own tag rather than the column
 * carrying one implied tone for all of them.
 *
 * Shown during idle/bridge-down as well as an active session (the user's
 * own call: most of the time this screen is open nothing is running, and
 * "what did the agent do while I wasn't watching" is the more useful
 * question then, not less). `sessionRunning` is what keeps that honest —
 * the feed itself doesn't change shape, but a visible note makes clear
 * that recent-looking entries are history, not a session in progress.
 */
export function SessionActivityCard({ activity, sessionRunning, wide = false }: SessionActivityCardProps) {
  return (
    <section className={`${styles.card}${wide ? ` ${styles.wide}` : ''}`}>
      <div className={styles.head}>
        <span className={styles.eyebrow}>Session activity</span>
        <span className={styles.source}>session_activity</span>
      </div>

      {sessionRunning === false && (
        <div className={styles.notRunning} data-testid="session-activity-not-running">
          No session is running right now — this is recent history, not live activity.
        </div>
      )}

      {activity === null ? (
        <div className={styles.empty} data-testid="session-activity-unavailable">
          Session activity is not available yet.
        </div>
      ) : activity.source_configured === false ? (
        <div className={styles.empty} data-testid="session-activity-not-configured">
          Provenance logging is not configured on this installation.
        </div>
      ) : activity.records.length === 0 ? (
        <div className={styles.empty} data-testid="session-activity-empty">
          No recorded activity yet.
        </div>
      ) : (
        <>
          <ul className={styles.list} data-testid="session-activity-list">
            {activity.records.map((record, i) => (
              <li key={`${record.ts ?? 'unknown'}-${i}`} className={styles.record} data-testid="session-activity-record">
                <div className={styles.recordHead}>
                  <span className={styles.ts}>{formatTs(record.ts)}</span>
                  <span
                    className={`${styles.origin} ${styles[`origin_${record.origin}`]}`}
                    data-testid="session-activity-origin"
                    data-origin={record.origin}
                  >
                    {ORIGIN_LABEL[record.origin]}
                  </span>
                </div>
                <div className={styles.tool}>{record.tool ?? '(unparsed record)'}</div>
                {record.args && Object.keys(record.args).length > 0 && (
                  <div className={styles.args}>{formatArgs(record.args)}</div>
                )}
              </li>
            ))}
          </ul>
          {activity.truncated && (
            <div className={styles.truncated} data-testid="session-activity-truncated">
              Showing the most recent records only.
            </div>
          )}
        </>
      )}
    </section>
  )
}

function formatTs(ts: string | null): string {
  if (!ts) return '—'
  const ms = parse(ts)
  return Number.isNaN(ms) ? ts : localHhMm(ms)
}

function formatArgs(args: Record<string, unknown>): string {
  return Object.entries(args)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' · ')
}
