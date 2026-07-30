import type { ArchiveNight } from '../../api/schemas'
import { formatMinutes, type MergedProject } from './projects'
import styles from './SessionHistory.module.css'

const FWHM_ABSENT_TITLE =
  'median_fwhm is null on every recorded session — see docs/handback-to-seestar-ai.md item 7'
const FILTER_ABSENT_TITLE = 'list_projects does not return a per-session filter field'

/** Why an archive-night row's FILTER/KEPT/TOTAL/MED FWHM cells are absent —
 * a different reason from a store session's absences above, so this is a
 * distinct title rather than reusing FILTER_ABSENT_TITLE/FWHM_ABSENT_TITLE
 * (which cite a store/schema gap that isn't what's happening here). Archive
 * frames were never scored by qa_tier2 at all: there is no kept/rejected
 * split, no filter captured per night (the scan's own filename regex
 * matches but does not capture that segment — see archive.py's
 * _LIGHT_FILENAME), and no FWHM measurement — only a night, a frame count
 * and a total, which land in the NIGHT and INTEGRATION cells instead. */
const ARCHIVE_ROW_ABSENT_TITLE =
  'this row is a raw archive night, not a QA session — it was never scored by qa_tier2, ' +
  'so there is no kept/rejected split, filter, or FWHM to show, only a frame count and a total'

function ArchiveNightRow({ night }: { night: ArchiveNight }) {
  return (
    <div className={`${styles.row} ${styles.archiveRow}`} role="row">
      <div className={styles.cell}>
        {night.night} <span className={styles.archiveTag}>archive</span>
      </div>
      <div className={`${styles.cell} ${styles.absent}`} title={ARCHIVE_ROW_ABSENT_TITLE}>
        —
      </div>
      <div className={`${styles.cell} ${styles.absent}`} title={ARCHIVE_ROW_ABSENT_TITLE}>
        —
      </div>
      <div className={`${styles.cell} ${styles.absent}`} title={ARCHIVE_ROW_ABSENT_TITLE}>
        —
      </div>
      <div className={`${styles.cell} ${styles.absent}`} title={ARCHIVE_ROW_ABSENT_TITLE}>
        —
      </div>
      <div className={styles.cell}>
        {night.frames} frames · {formatMinutes(night.minutes)}
      </div>
    </div>
  )
}

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
 * elsewhere in the app. `ArchiveNight.night`, by contrast, already IS the
 * observing night — it comes from the sidecar's own `observing_night()` (see
 * archive.py) — so the two row types render two different notions of "night"
 * under one column, both honestly labeled by what produced them.
 *
 * For a target recorded in both sources (M31, M27, NGC281, M57 today), the
 * table used to show only the store's own sessions — the archive side of the
 * union wasn't broken out per night anywhere this screen could reach, so the
 * table's own total read lower than the card's `total_minutes`, with a note
 * below explaining the gap. `/api/projects_combined` now exposes that detail
 * as `nights` (see `ProjectsCombinedEntrySchema`), already de-duplicated
 * against the store's own sessions server-side, so `ArchiveNightRow`s render
 * alongside the store's session rows below and the table closes: no
 * re-filtering or reconciliation happens here, only rendering what the
 * response already carries. See docs/slice-2-backlog.md for the prior state
 * of this gap.
 */
export function SessionHistory({ project }: { project: MergedProject }) {
  const label = `${project.targetId} · SESSION HISTORY — log_session_result`
  const sessions = project.store?.sessions ?? []
  const nights = project.nights
  const hasRows = sessions.length > 0 || nights.length > 0

  if (!hasRows) {
    return (
      <section className={styles.card}>
        <div className={styles.label}>{label}</div>
        <div className={styles.empty}>
          {project.store
            ? `No sessions logged for ${project.targetName} yet.`
            : `${project.targetName} has no per-night archive record and no store sessions — there is nothing to show yet.`}
        </div>
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
      {nights.map((night) => (
        <ArchiveNightRow key={night.night} night={night} />
      ))}
    </section>
  )
}
