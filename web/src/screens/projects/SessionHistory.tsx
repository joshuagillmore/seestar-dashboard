import { formatMinutes, type MergedProject } from './projects'
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
 * The micro-label names `log_session_result` (README.md:669), matching the
 * design exactly — not `list_projects`, which is what this screen actually
 * calls to read the rows. `log_session_result` is the write tool that
 * produced each session record historically; `list_projects` only reads what
 * it already wrote. The design's own convention elsewhere (Tonight's
 * `Observing planner · assess_conditions`) names the tool whose *data* is
 * shown, not the read path used to fetch it, so this follows that rather
 * than inventing a different rule for one label. `log_session_result` stays
 * a write tool with no route (see allowlist.py's FORBIDDEN_TOOLS) — naming
 * it here is not a call to it.
 *
 * NIGHT renders the session's raw `date_utc` calendar date. The server has a
 * dedicated, tested `observing_night()` that shifts a UTC instant onto the
 * correct local evening (a session logged past local midnight is still
 * "last night's"); reimplementing that here, without the site's UTC offset,
 * would be exactly the re-derivation the hand-back rule forbids. So this is
 * the UTC calendar date, not necessarily the observing night — see the
 * slice-2-backlog's "Timezone marker" note for the same accepted gap
 * elsewhere in the app.
 *
 * For the four targets recorded in both sources (M31, M27, NGC281, M57), the
 * table above only ever shows the store's own sessions — the archive side of
 * the union isn't broken out per night anywhere this screen can reach, so
 * the table's own total reads lower than the card's `total_minutes`. A note
 * below the table says so whenever `archiveMinutes > 0`, rather than leaving
 * the gap unexplained. This is a display limitation, not a permanent one:
 * `scan_archive()` already computes a per-night `ArchiveNight` record
 * internally (see archive.py) — `/api/projects_combined` just doesn't expose
 * it yet. See docs/slice-2-backlog.md.
 */
export function SessionHistory({ project }: { project: MergedProject }) {
  const label = `${project.targetId} · SESSION HISTORY — log_session_result`

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
  const archiveNote = project.archiveMinutes > 0 && (
    <div className={styles.archiveNote}>
      plus {formatMinutes(project.archiveMinutes)} from the archive, not itemised per night
      here.
    </div>
  )

  if (sessions.length === 0) {
    return (
      <section className={styles.card}>
        <div className={styles.label}>{label}</div>
        <div className={styles.empty}>No sessions logged for {project.targetName} yet.</div>
        {archiveNote}
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
      {archiveNote}
    </section>
  )
}
