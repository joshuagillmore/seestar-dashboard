import { parse } from '../tonight/timeline'
import { formatDuration, formatWhen } from './timestamps'
import styles from './TargetHeader.module.css'

export interface TargetHeaderProps {
  /** `get_view_state`'s View block does carry a `target_name` (confirmed on
   * hardware 2026-07-31 — see ViewSchema's own doc comment for the earlier,
   * wrong assumption this corrects), but it is a catalogue id ("NGC7380"),
   * not a resolved common name — `get_target_observability`'s own
   * `target.name` ("Wizard Nebula") is the richer source once it resolves,
   * still ahead of it in LiveScreen's fallback chain. The catalogue id
   * `live_preview` parsed from the share's directory name (see
   * useLiveSession's `currentTarget`) is the last resort, before either has
   * anything. */
  targetName: string | null
  /** e.g. "3PPA", "AutoGoto", "Stack" — `get_view_state`'s own `stage`. */
  stage: string | null
  /** `get_view_state`'s View block's own `lp_filter` — a genuine boolean,
   * confirmed on hardware alongside `target_name` (ViewSchema's doc
   * comment). `true`/`false` render distinct chips ("LP filter" on vs. off);
   * `null`/`undefined` (the field missing from a payload, e.g. a firmware
   * that doesn't send it, or before `get_view_state` has answered at all)
   * renders no chip — an unknown filter state must not read as "off". */
  lpFilter?: boolean | null
  /** The run's real start: `get_run_state`'s `run.session_start_utc`, and
   * only while that run is `active` (useLiveSession's `sessionStartUtc`).
   * Never the "since this tab first looked" fallback the guardrail check
   * uses — that is not a start, and must not be shown as one. `null` or
   * absent renders no start at all. */
  sessionStartUtc?: string | null
}

/**
 * Design README.md:438-444, with one thing slice-3 §0 explicitly drops: no
 * button row. `Refocus` / `Stop stack` / `Wind down & park` each mapped to a
 * forbidden write tool; the rule from CLAUDE.md's own hand-off note is
 * "never a disabled button", so there is nothing here in their place, not a
 * greyed-out row.
 *
 * The LP filter chip the design also shows (accent-tinted, beside the
 * target name) was dropped for the same reason through slice 3 — handback
 * items 5/14 said the live filter state wasn't returned — but hardware
 * settled that 2026-07-31: `lp_filter` is a real boolean on the View block.
 * See `lpFilter`'s own doc comment for why `true`/`false`/absent are three
 * distinct renders, not two.
 *
 * "started HH:MM · elapsed …" renders from `get_run_state`'s
 * `run.session_start_utc` (handback item 20, fetched every poll) while the
 * run is active. This comment used to say no source existed. There is still
 * none for a session started by hand from the phone app, which writes no
 * run_state; then nothing is shown. The client-observed "since I've been
 * watching" time useLiveSession falls back to for `check_night_guardrails`
 * is never shown here: presenting when a tab happened to open as the
 * session's start would be a fake measurement.
 */
export function TargetHeader({ targetName, stage, lpFilter, sessionStartUtc = null }: TargetHeaderProps) {
  const started = formatWhen(sessionStartUtc)
  const startMs = sessionStartUtc ? parse(sessionStartUtc) : Number.NaN
  return (
    <section className={styles.card}>
      <div className={styles.row}>
        <h2 className={styles.name}>{targetName ?? 'Target unknown'}</h2>
        {lpFilter != null && (
          <span
            className={`${styles.chip} ${lpFilter ? styles.chipOn : styles.chipOff}`}
            data-testid="lp-filter-chip"
            data-lp-filter={lpFilter}
          >
            {lpFilter ? 'LP filter' : 'LP filter off'}
          </span>
        )}
      </div>
      <div className={styles.meta}>
        get_view_state · stage {stage ?? '—'}
        {started !== null && (
          <span data-testid="session-started">
            {' '}· started {started}
            {startMs <= Date.now() && ` · elapsed ${formatDuration(Date.now() - startMs)}`}
          </span>
        )}
      </div>
    </section>
  )
}
