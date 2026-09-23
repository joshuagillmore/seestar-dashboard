import type { QaAnalysisResponse } from '../../api/schemas'
import styles from './ReviewStates.module.css'

/**
 * The Review screen's non-report states, written ONCE for both layouts.
 *
 * Desktop and mobile each used to carry their own copy of this branching, and
 * mobile's drifted: it read a status still loading, or one that failed to
 * load, as "No analysis yet" with an Analyse button; it never showed the
 * screen's error; and it presented a stale report as current. The layouts
 * now differ only in where they put these, never in what they say.
 */

export interface AnalysisStateProps {
  selected: string | null
  status: QaAnalysisResponse | null
  error: string | null
  starting: boolean
  /** The selected target's sub count — the scale the Analyse button commits
   * to, shown before anything is started. */
  subCount: number
  onAnalyse: () => void
  /** Re-read the selected target's status. Never starts anything. */
  onReload: () => void
  /** Shorter copy for a phone. The states and controls are identical. */
  compact?: boolean
}

/**
 * Everything the screen shows for a target that has no report to render —
 * or nothing at all when it has one.
 *
 * Only `not_analysed`, `failed` and `stale` offer to start an analysis. The
 * states where the screen simply does not know yet (still reading, or the
 * read failed) offer to read again, never to start: a loading screen with an
 * Analyse button invites minutes of work nobody asked for.
 */
export function AnalysisState({
  selected,
  status,
  error,
  starting,
  subCount,
  onAnalyse,
  onReload,
  compact = false,
}: AnalysisStateProps) {
  if (selected == null) {
    return (
      <div className={styles.stack}>
        <p className={styles.text}>
          {compact
            ? 'Pick a target to see its analysis. Nothing runs until you ask for it.'
            : 'Pick a target to see its analysis. Nothing runs until you ask for it — a full session is minutes of work, so the sub count on each row is what you are committing to.'}
        </p>
      </div>
    )
  }

  if (status == null) {
    if (error) {
      return (
        <div className={styles.stack} role="alert">
          <p className={styles.text}>Could not read this target&rsquo;s analysis status. {error}</p>
          <button type="button" className={styles.action} onClick={onReload}>
            Try again
          </button>
        </div>
      )
    }
    return (
      <div className={styles.stack} role="status">
        <p className={styles.text}>Reading this target&rsquo;s analysis status…</p>
      </div>
    )
  }

  const analyseButton = (label: string) => (
    <button type="button" className={styles.action} onClick={onAnalyse} disabled={starting}>
      {starting ? 'Starting…' : label}
    </button>
  )

  switch (status.status) {
    case 'not_analysed':
      return (
        <div className={styles.stack}>
          <p className={styles.text}>
            No analysis yet for this target. That is the ordinary state of a fresh archive, not a
            problem.
          </p>
          {analyseButton(`Analyse ${subCount} subs`)}
        </div>
      )
    case 'running':
      return (
        <div className={styles.stack} role="status">
          <p className={styles.text}>
            Analysing {subCount} subs — {status.elapsed_seconds}s elapsed.
            {compact
              ? ''
              : ' This takes minutes on a real session; the page polls and will fill in when it finishes.'}
          </p>
        </div>
      )
    case 'failed':
      return (
        <div className={styles.stack}>
          <p className={styles.text}>The analysis failed.{status.error ? ` ${status.error}` : ''}</p>
          {analyseButton('Try again')}
        </div>
      )
    case 'complete':
    case 'stale':
      if (status.report != null) return null
      // Finished, but the response came without its report. Re-reading the
      // status fetches it; starting again would only answer from the same
      // cache and loop.
      return (
        <div className={styles.stack}>
          <p className={styles.text}>
            This target has a finished analysis, but its report did not come back with the
            status.
          </p>
          <button type="button" className={styles.action} onClick={onReload}>
            Load the report
          </button>
        </div>
      )
  }
}

export interface StaleNoticeProps {
  subCount: number
  starting: boolean
  onAnalyse: () => void
}

/**
 * The way out of a stale report. Without it a stale report was a dead end:
 * the only Analyse buttons lived in the not_analysed and failed states, so new
 * subs arriving — an entirely ordinary event — left obsolete numbers on screen
 * with no way to refresh them, though the start endpoint recomputes happily
 * on a changed signature.
 */
export function StaleNotice({ subCount, starting, onAnalyse }: StaleNoticeProps) {
  return (
    <div className={styles.staleBar}>
      <p className={styles.text}>
        New subs have arrived since this ran, so these numbers describe an older set.
        Re-analysing covers all {subCount} on disk now.
      </p>
      <button type="button" className={styles.action} onClick={onAnalyse} disabled={starting}>
        {starting ? 'Starting…' : `Re-analyse ${subCount} subs`}
      </button>
    </div>
  )
}

/** The screen's error, placed by each layout — see errorNoteText in
 * statusHelpers.ts for when there is one to show. */
export function ErrorNote({ text }: { text: string }) {
  return (
    <p className={styles.errorNote} role="alert">
      {text}
    </p>
  )
}
