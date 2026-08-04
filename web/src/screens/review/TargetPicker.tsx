import type { QaTarget, QaTargets } from '../../api/schemas'
import styles from './TargetPicker.module.css'

export interface TargetPickerProps {
  targets: QaTargets
  selected: string | null
  onSelect: (targetId: string) => void
}

/** What each status means to someone standing in front of the screen. The
 * words matter: "not analysed" is the ordinary state of a fresh archive, not
 * a failure, and must not read like one.
 *
 * These are JOB states — does a report exist, is one running, did one error —
 * and none of them is a statement about sub quality. `complete` used to carry
 * the tone `pass`, which painted it in `--pass`, the PASS verdict green, on
 * the one screen whose whole vocabulary is PASS/MARGINAL/REJECT. Every
 * analysed row read as a good result: a target that scored 90% REJECT still
 * showed green. It is `ready` now, and toned by brightness rather than hue —
 * bright means a report exists, faint means it does not, and neither claims
 * anything about what the report says. */
function statusLabel(target: QaTarget): { text: string; tone: string } {
  switch (target.status) {
    case 'complete':
      return { text: 'analysed', tone: 'ready' }
    case 'stale':
      return { text: 'stale', tone: 'marginal' }
    case 'running':
      return { text: 'running…', tone: 'running' }
    case 'failed':
      return { text: 'failed', tone: 'reject' }
    default:
      return { text: 'not analysed', tone: 'idle' }
  }
}

/**
 * Every target the archive scan found, with its analysis status and — the
 * important part — its **sub count, shown before anything is started**.
 *
 * `qa_tier2` is minutes long over a real target: 200–1400 subs. The spec's
 * honesty requirement is that the user sees the scale they are committing to
 * before they commit, so "842 subs" sits on the row next to the button. This
 * listing itself never triggers analysis; `/api/qa_targets` structurally
 * cannot.
 *
 * Sorted by sub count descending — the biggest targets are both the most
 * interesting to review and the most expensive to run, so they should not be
 * buried.
 */
export function TargetPicker({ targets, selected, onSelect }: TargetPickerProps) {
  const rows = [...targets.targets].sort((a, b) => b.sub_count - a.sub_count)
  const archive = targets.archive_status

  if (!archive.configured) {
    return (
      <div className={styles.panel}>
        <div className={styles.eyebrow}>Targets</div>
        <p className={styles.note}>
          No archive configured. Set <code>SEESTAR_ARCHIVE_DIR</code> to the folder holding your
          captured subs — see <code>docs/configuration.md</code>.
        </p>
      </div>
    )
  }

  if (!archive.exists) {
    return (
      <div className={styles.panel}>
        <div className={styles.eyebrow}>Targets</div>
        <p className={styles.note}>
          <code>SEESTAR_ARCHIVE_DIR</code> is set but that path does not exist. Nothing can be
          analysed until it points somewhere real.
        </p>
      </div>
    )
  }

  return (
    <div className={styles.panel}>
      <div className={styles.eyebrow}>Targets · {rows.length}</div>

      {rows.length === 0 ? (
        <p className={styles.note}>
          The archive folder is there but holds no captured subs yet. Nothing to review.
        </p>
      ) : (
        <ul className={styles.list}>
          {rows.map((target) => {
            const status = statusLabel(target)
            const isSelected = target.target_id === selected
            return (
              <li key={target.target_id}>
                <button
                  type="button"
                  className={`${styles.row} ${isSelected ? styles.selected : ''}`}
                  onClick={() => onSelect(target.target_id)}
                  aria-current={isSelected}
                >
                  <span className={styles.name} title={target.display_name}>
                    {target.display_name}
                  </span>
                  <span className={styles.subs}>{target.sub_count} subs</span>
                  <span className={`${styles.status} ${styles[status.tone]}`}>{status.text}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
