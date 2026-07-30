import type { SiteProfile } from '../api/schemas'
import { verdictTone, type Verdict } from '../api/verdict'
import type { View } from './view'
import { Dot, type DotTone } from '../ui/Dot'
import styles from './Sidebar.module.css'

interface NavItem {
  view: View
  label: string
  /** Present only for a screen not built yet — its literal text becomes the
   * row's meta and the row is disabled. Absent means the row is live: it
   * navigates on click and its meta comes from real data instead. */
  disabledLabel?: string
}

const NAV_ITEMS: NavItem[] = [
  { view: 'tonight', label: "Tonight's plan" },
  { view: 'live', label: 'Live session', disabledLabel: 'slice 3' },
  { view: 'review', label: 'Review & QA', disabledLabel: 'slice 4' },
  { view: 'projects', label: 'Projects' },
]

export interface SidebarProps {
  site: SiteProfile | null
  verdict: Verdict | null
  /**
   * `location.warning` from assess_conditions, or null when the site is
   * confirmed. The design specifies a GPS row in **both** the sidebar
   * (README.md:249-250: short form, `GPS matched · mask ON (3 arcs)`) and the
   * Tonight verdict banner (README.md:273-274: the full sentence, e.g. `GPS
   * matched site 'Backyard' (0.2 km) — horizon mask applied`) — complementary,
   * not duplicated, since the two say different things. This prop drives only
   * the *presence* of a caveat here (`gpsWarning !== null`), not its exact
   * wording — the sidebar renders a fixed short label ("GPS unverified" /
   * "GPS matched"), never the warning sentence itself, which is
   * VerdictBanner's job. That split avoids both re-parsing the warning prose
   * for a short form (which isn't available split out from it) and printing
   * the same long sentence in two places.
   */
  gpsWarning: string | null
  /** Which screen is currently mounted — drives the active highlight. Owned
   * by App.tsx; Sidebar stays presentational. */
  view: View
  onNavigate: (view: View) => void
  /**
   * Headline number for the Projects nav row's meta slot, e.g. "30.6 h" —
   * null renders an honest dash. Only the mounted ProjectsScreen actually has
   * this figure (there is no shared data layer across screens yet), so every
   * other screen's Sidebar instance passes null rather than a stale or
   * fabricated number.
   *
   * Kept as hours rather than switched to a "N need data" count (the
   * design's own sample meta, README.md:241): the header above the grid
   * already spells out the need-data count in full, so repeating it in the
   * nav row would show the same number twice while dropping the one figure
   * (total hours) that's only visible here.
   */
  projectsHeadline?: string | null
  /**
   * How many merged projects currently read `needs-data` (see
   * screens/projects/projects.ts's projectStatus) — drives the Projects nav
   * row's dot tone, the same way `verdict` drives Tonight's (see the design's
   * "the dot encodes each screen's health … both must be live",
   * README.md:243-244). `null` — the default, and what every screen other
   * than the mounted ProjectsScreen passes — renders `idle` rather than a
   * fabricated health signal.
   */
  projectsNeedsData?: number | null
}

export function Sidebar({
  site,
  verdict,
  gpsWarning,
  view,
  onNavigate,
  projectsHeadline = null,
  projectsNeedsData = null,
}: SidebarProps) {
  const profile = site?.profile

  return (
    <nav className={styles.rail}>
      <div className={styles.eyebrow}>Session</div>

      {NAV_ITEMS.map((item) => {
        const disabled = item.disabledLabel !== undefined
        const active = view === item.view
        const tone: DotTone =
          item.view === 'tonight'
            ? verdict
              ? verdictTone(verdict)
              : 'idle'
            : item.view === 'projects' && projectsNeedsData !== null
              ? projectsNeedsData > 0
                ? 'marginal'
                : 'pass'
              : 'idle'
        const meta = disabled
          ? item.disabledLabel
          : item.view === 'tonight'
            ? (verdict ?? '—')
            : (projectsHeadline ?? '—')

        return (
          <button
            key={item.view}
            className={`${styles.nav} ${active ? styles.navActive : ''}`}
            disabled={disabled}
            aria-current={active ? 'page' : undefined}
            onClick={disabled ? undefined : () => onNavigate(item.view)}
          >
            <Dot tone={tone} />
            <span className={styles.label}>{item.label}</span>
            <span className={styles.meta}>{meta}</span>
          </button>
        )
      })}

      <div className={styles.spacer} />

      {profile && (
        <div className={styles.site}>
          <div className={styles.eyebrow}>Site profile</div>
          <div className={styles.siteName}>{profile.name}</div>
          <div className={styles.siteMeta}>
            {/* The sign carries the hemisphere; it must be read from the
                payload, not assumed. lat_deg/lon_deg are signed floats — a
                southern or eastern site must not render "N"/"W" regardless. */}
            {Math.abs(profile.lat_deg).toFixed(3)} {profile.lat_deg >= 0 ? 'N' : 'S'} ·{' '}
            {Math.abs(profile.lon_deg).toFixed(3)} {profile.lon_deg >= 0 ? 'E' : 'W'}
          </div>
          <div className={styles.siteMeta}>
            Bortle {profile.bortle ?? '—'} · floor {profile.min_altitude_deg}° · ceiling{' '}
            {profile.field_rotation_ceiling_deg}°
          </div>
          {/* Short form, one row: GPS state and mask state together, per
              README.md:249-250. A fixed short label ("GPS unverified" /
              "GPS matched"), not the full warning sentence — see
              SidebarProps.gpsWarning's doc comment for why the sentence
              itself belongs only to VerdictBanner. */}
          <div className={gpsWarning ? styles.warnRow : styles.okRow}>
            <Dot tone={gpsWarning ? 'marginal' : 'pass'} size="sm" />
            <span>
              {gpsWarning ? 'GPS unverified' : 'GPS matched'} · mask{' '}
              {profile.horizon_mask.length > 0
                ? `on (${profile.horizon_mask.length} arcs)`
                : 'off'}
            </span>
          </div>
        </div>
      )}
    </nav>
  )
}
