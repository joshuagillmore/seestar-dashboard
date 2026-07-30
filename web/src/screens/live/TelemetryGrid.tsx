import type { FocuserPosition, StackState } from '../../api/schemas'
import { droppedPct, focusDelta, formatAnnotateState, formatStageHistory, stackedDiff } from './telemetryFormatting'
import type { TelemetryEntry } from './telemetryLog'
import styles from './TelemetryGrid.module.css'

export interface TelemetryGridProps {
  stack: StackState | null
  log: TelemetryEntry[]
  focuser: FocuserPosition | null
  focuserBaseline: number | null
  stage: string | null
  stageHistory: string[]
}

interface Cell {
  label: string
  value: string
  sub: string | null
  tone?: 'pass'
}

/**
 * Six cells, `repeat(3, minmax(0,1fr))` (design README.md:420-425). The
 * design's own warning is load-bearing: `1fr`'s default minimum is
 * `min-content`, which overflowed the prototype's container twice when a
 * label couldn't shrink. See TelemetryGrid.module.css.
 *
 * INTEGRATION renders an honest absent state rather than a fabricated
 * minutes-kept figure: that needs the sub exposure length actually running
 * this session, which nothing this client has confirmed `get_view_state`
 * returns (`recommended_exposure_s` on a `plan_targets` entry is a *planned*
 * figure for a different tool, not necessarily what's live) — see
 * handback-to-seestar-ai.md's newest item. DROPPED shows the plain
 * percentage of frames but not the design's "rotation trailing" cause —
 * this client has no field naming *why* frames dropped, and guessing one
 * would be exactly the derived-assessment problem this project avoids
 * elsewhere (VerdictBanner's headline, the QA verdict banner, …).
 */
export function TelemetryGrid({ stack, log, focuser, focuserBaseline, stage, stageHistory }: TelemetryGridProps) {
  const diff = stackedDiff(log)
  const pct = droppedPct(stack?.stacked_frame ?? null, stack?.dropped_frame ?? null)
  const delta = focusDelta(focuser?.position ?? null, focuserBaseline)
  const solveTone = stack?.Annotate?.state ? ('pass' as const) : undefined

  const cells: Cell[] = [
    {
      label: 'STACKED',
      value: stack?.stacked_frame != null ? String(stack.stacked_frame) : '—',
      sub: diff !== null ? `${diff >= 0 ? '+' : ''}${diff} last poll` : null,
    },
    {
      label: 'DROPPED',
      value: stack?.dropped_frame != null ? String(stack.dropped_frame) : '—',
      sub: pct !== null ? `${pct.toFixed(1)}% of frames` : null,
    },
    {
      label: 'INTEGRATION',
      value: '—',
      sub: 'exposure length not yet returned by get_view_state',
    },
    {
      label: 'PLATE SOLVE',
      value: formatAnnotateState(stack?.Annotate?.state),
      sub: stack?.Annotate ? 'annotate live' : null,
      tone: solveTone,
    },
    {
      label: 'FOCUS',
      value: focuser?.position != null ? String(focuser.position) : '—',
      sub:
        focuserBaseline !== null && delta !== null
          ? `baseline ${focuserBaseline} · Δ${delta >= 0 ? '+' : ''}${delta}`
          : null,
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
