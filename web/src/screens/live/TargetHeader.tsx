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
}

/**
 * Design README.md:412-418, with one thing slice-3 §0 explicitly drops: no
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
 * "started HH:MM · elapsed …" is also absent: it needs a session-start time
 * this client has no source for (get_view_state does not confirm one — the
 * client-observed timestamp `useLiveSession` tracks for `check_night_
 * guardrails` is honestly "since I've been watching", not the scope's real
 * start, so it is not shown as if it were one), and fabricating one from
 * "whenever this screen happened to be opened" would be a fake measurement,
 * not a real one — see PreviewCard's `captured_at` for the contrast (a real
 * timestamp the server actually returns).
 */
export function TargetHeader({ targetName, stage, lpFilter }: TargetHeaderProps) {
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
      <div className={styles.meta}>get_view_state · stage {stage ?? '—'}</div>
    </section>
  )
}
