import styles from './TargetHeader.module.css'

export interface TargetHeaderProps {
  targetName: string | null
  /** e.g. "3PPA", "AutoGoto", "Stack" — `get_view_state`'s own `stage`. */
  stage: string | null
}

/**
 * Design README.md:412-418, with the two things slice-3 §0 explicitly drops:
 * no LP filter chip (the live filter state isn't returned — see
 * handback-to-seestar-ai.md items 5/14) and no button row at all. `Refocus`
 * / `Stop stack` / `Wind down & park` each mapped to a forbidden write tool;
 * the rule from CLAUDE.md's own hand-off note is "never a disabled button",
 * so there is nothing here in their place, not a greyed-out row.
 *
 * "started HH:MM · elapsed …" is also absent: it needs a session-start time
 * this client has no source for (get_view_state does not confirm one), and
 * fabricating one from "whenever this screen happened to be opened" would
 * be a fake measurement, not a real one — see PreviewCard's `captured_at`
 * for the contrast (a real timestamp the server actually returns).
 */
export function TargetHeader({ targetName, stage }: TargetHeaderProps) {
  return (
    <section className={styles.card}>
      <div className={styles.row}>
        <h2 className={styles.name}>{targetName ?? 'Target unknown'}</h2>
      </div>
      <div className={styles.meta}>get_view_state · stage {stage ?? '—'}</div>
    </section>
  )
}
