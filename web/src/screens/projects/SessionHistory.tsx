import type { MergedProject } from './projects'
import styles from './SessionHistory.module.css'

const FWHM_ABSENT_TITLE =
  'median_fwhm is null on every recorded session — see docs/handback-to-seestar-ai.md item 7'
const FILTER_ABSENT_TITLE = 'list_projects does not return a per-session filter field'

/**
 * Scoped to whichever card is selected (see ProjectsScreen). The design's six
 * columns are NIGHT / FILTER / KEPT / TOTAL / MED FWHM / INTEGRATION; FILTER
 * has no source anywhere in SessionRecord (not merely null — the field does
 * not exist), and MED FWHM is null on every session recorded so far
 * (handback item 7). Both render as an honest "—" rather than the design
 * mockup's fabricated "IRCUT · alt-az" / numeric FWHM.
 *
 * NIGHT renders the session's raw `date_utc` calendar date. The server has a
 * dedicated, tested `observing_night()` that shifts a UTC instant onto the
 * correct local evening (a session logged past local midnight is still
 * "last night's"); reimplementing that here, without the site's UTC offset,
 * would be exactly the re-derivation the hand-back rule forbids. So this is
 * the UTC calendar date, not necessarily the observing night — see the
 * slice-2-backlog's "Timezone marker" note for the same accepted gap
 * elsewhere in the app.
 */
export function SessionHistory({ project }: { project: MergedProject }) {
  const label = `${project.targetId} · SESSION HISTORY — list_projects`

  if (!project.store) {
    return (
      <section className={styles.card}>
        <div className={styles.label}>{label}</div>
        <div className={styles.empty}>
          {project.targetName} appears only in the archive scan, which reports aggregate
          minutes per target, not individual session records — there is no per-night
          history to show.
        </div>
      </section>
    )
  }

  const sessions = project.store.sessions

  if (sessions.length === 0) {
    return (
      <section className={styles.card}>
        <div className={styles.label}>{label}</div>
        <div className={styles.empty}>No sessions logged for {project.targetName} yet.</div>
      </section>
    )
  }

  return (
    <section className={styles.card}>
      <div className={styles.label}>{label}</div>
      <div className={styles.headerRow} role="row">
        <div className={styles.headerCell}>NIGHT</div>
        <div className={styles.headerCell}>FILTER</div>
        <div className={styles.headerCell}>KEPT</div>
        <div className={styles.headerCell}>TOTAL</div>
        <div className={styles.headerCell}>MED FWHM</div>
        <div className={styles.headerCell}>INTEGRATION</div>
      </div>
      {sessions.map((session) => (
        <div key={session.date_utc} className={styles.row} role="row" title={session.notes || undefined}>
          <div className={styles.cell}>{session.date_utc.slice(0, 10)}</div>
          <div className={`${styles.cell} ${styles.absent}`} title={FILTER_ABSENT_TITLE}>
            —
          </div>
          <div className={styles.cell}>{session.subs_kept}</div>
          <div className={styles.cell}>{session.subs_total}</div>
          <div
            className={`${styles.cell} ${session.median_fwhm === null ? styles.absent : ''}`}
            title={session.median_fwhm === null ? FWHM_ABSENT_TITLE : undefined}
          >
            {session.median_fwhm === null ? '—' : `${session.median_fwhm.toFixed(2)} px`}
          </div>
          <div className={styles.cell}>{session.integration_minutes.toFixed(1)} min</div>
        </div>
      ))}
    </section>
  )
}
