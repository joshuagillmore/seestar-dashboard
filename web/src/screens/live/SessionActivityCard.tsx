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
}

const ORIGIN_LABEL: Record<SessionActivityRecord['origin'], string> = {
  agent: 'agent',
  ambiguous: 'ambiguous',
  unknown: 'unknown',
}

/**
 * The design's operator panel (README.md:481-510) pictures a chat transcript
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
 * item 10 is that the log carries no client identifier at all, so this
 * dashboard's OWN polling sits in the same file as the agent's calls,
 * indistinguishable unless the tag is provably agent-only. So this column
 * is headed "Session activity", never "Claude" — an `ambiguous` record is
 * never presented as the agent's, and every record carries its own origin
 * tag rather than the column carrying one implied tone for all of them.
 */
export function SessionActivityCard({ activity }: SessionActivityCardProps) {
  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <span className={styles.eyebrow}>Session activity</span>
        <span className={styles.source}>session_activity</span>
      </div>

      {activity === null ? (
        <div className={styles.empty} data-testid="session-activity-unavailable">
          Session activity is not available yet.
        </div>
      ) : activity.source_configured === false ? (
        <div className={styles.empty} data-testid="session-activity-not-configured">
          Provenance logging is not configured on this installation.
        </div>
      ) : activity.records.length === 0 ? (
        <div className={styles.empty}>No recorded activity yet.</div>
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
