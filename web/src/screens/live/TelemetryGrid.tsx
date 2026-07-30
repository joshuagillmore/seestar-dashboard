import type { FocuserPosition, StackState, Tier1 } from '../../api/schemas'
import { ANNOTATE_STATE_OK, droppedPct, formatAnnotateState, formatStageHistory } from './telemetryFormatting'
import styles from './TelemetryGrid.module.css'

export interface TelemetryGridProps {
  /** From `get_view_state`'s `Stack` — the source for Annotate/plate-solve,
   * which `qa_tier1` does not carry. */
  stack: StackState | null
  /** From `qa_tier1` — the preferred source for STACKED/DROPPED/FOCUS and
   * their per-poll deltas, since the server already computes `trends`
   * rather than this client diffing polls itself. */
  tier1: Tier1 | null
  focuser: FocuserPosition | null
  stage: string | null
  stageHistory: string[]
}

interface Cell {
  label: string
  value: string
  sub: string | null
  tone?: 'pass'
}

const signed = (n: number): string => `${n >= 0 ? '+' : ''}${n}`

/**
 * Six cells, `repeat(3, minmax(0,1fr))` (design README.md:420-425). The
 * design's own warning is load-bearing: `1fr`'s default minimum is
 * `min-content`, which overflowed the prototype's container twice when a
 * label couldn't shrink. See TelemetryGrid.module.css.
 *
 * STACKED/DROPPED/FOCUS prefer `qa_tier1`'s `snapshot`/`trends` (the server
 * already computes "delta since the previous poll"; this client used to
 * recompute that itself before the real shape was confirmed) and fall back
 * to `get_view_state`'s raw `Stack` counts, with no delta, if `qa_tier1`
 * itself failed this poll. INTEGRATION renders an honest absent state
 * rather than a fabricated minutes-kept figure: that needs the sub exposure
 * length actually running this session, which nothing this client has
 * confirmed any tool returns. DROPPED shows the plain percentage of frames
 * but not the design's "rotation trailing" cause — this client has no field
 * naming *why* frames dropped, and guessing one would be exactly the
 * derived-assessment problem this project avoids elsewhere (VerdictBanner's
 * headline, the QA verdict banner, …).
 */
export function TelemetryGrid({ stack, tier1, focuser, stage, stageHistory }: TelemetryGridProps) {
  const snapshot = tier1?.snapshot
  const trends = tier1?.trends

  const stackedValue = snapshot?.stacked ?? stack?.stacked_frame ?? null
  const droppedValue = snapshot?.rejected ?? stack?.dropped_frame ?? null
  const pct = droppedPct(stackedValue, droppedValue)
  const focusValue = snapshot?.focus_pos ?? focuser?.focus_pos ?? null
  const annotateState = stack?.Annotate?.state
  const solveTone = annotateState === ANNOTATE_STATE_OK ? ('pass' as const) : undefined

  const cells: Cell[] = [
    {
      label: 'STACKED',
      value: stackedValue != null ? String(stackedValue) : '—',
      sub: trends?.stacked_delta != null ? `${signed(trends.stacked_delta)} last poll` : null,
    },
    {
      label: 'DROPPED',
      value: droppedValue != null ? String(droppedValue) : '—',
      sub: pct !== null ? `${pct.toFixed(1)}% of frames` : null,
    },
    {
      label: 'INTEGRATION',
      value: '—',
      sub: 'exposure length not yet returned by any tool',
    },
    {
      label: 'PLATE SOLVE',
      value: formatAnnotateState(annotateState),
      sub: stack?.Annotate ? 'annotate live' : null,
      tone: solveTone,
    },
    {
      label: 'FOCUS',
      value: focusValue != null ? String(focusValue) : '—',
      sub: trends?.focus_delta != null ? `Δ${signed(trends.focus_delta)} last poll` : null,
    },
    {
      label: 'STAGE',
      value: stage ?? '—',
      sub: stageHistory.length > 0 ? formatStageHistory(stageHistory) : null,
    },
  ]

  return (
    <div className={styles.grid} data-testid="telemetry-grid">
      {cells.map((cell) => (
        <div key={cell.label} className={styles.cell}>
          <div className={styles.label}>{cell.label}</div>
          <div className={`${styles.value} ${cell.tone ? styles[cell.tone] : ''}`}>{cell.value}</div>
          {cell.sub && <div className={styles.sub}>{cell.sub}</div>}
        </div>
      ))}
    </div>
  )
}
