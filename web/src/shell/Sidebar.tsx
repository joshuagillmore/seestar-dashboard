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
  { view: 'live', label: 'Live session' },
  { view: 'review', label: 'Review & QA', disabledLabel: 'slice 4' },
  { view: 'projects', label: 'Projects' },
]

export interface SidebarProps {
  site: SiteProfile | null
  verdict: Verdict | null
  /**
   * `location.warning` from assess_conditions. **No longer read by Sidebar**
   * — see `gpsMatched` below, which replaced it as the row's actual source
   * of truth. Kept in the type only so callers outside `web/src/shell/`
   * (TonightScreen passes it; ProjectsScreen passes `null`) don't need an
   * edit for this. Superseded, not merely unused: the row used to derive its
   * two states from "is there a warning at all", which conflated two
   * genuinely different server states (see `gpsMatched`) — carrying only
   * this string could never have told them apart without parsing its prose,
   * which is exactly what `gpsMatched` avoids needing.
   */
  gpsWarning: string | null
  /**
   * `location.matched` from assess_conditions — `true` (GPS confirmed within
   * tolerance), `false` (GPS confirmed elsewhere: a real mismatch, and the
   * server explicitly does **not** apply the horizon mask in this state), or
   * `null` (GPS unknown/never checked — the server assumes the saved site
   * and *does* still apply the mask). Verified at the source
   * (`SeeStar-AI/src/seestar_mcp/server.py`'s `_location_block`): its
   * `mask_applied` field is `false` if and only if `matched` is `false` — so
   * this one field is a complete, non-inferred, non-prose-parsed source for
   * both halves of the row (design README.md:249-250: `GPS matched · mask ON
   * (3 arcs)`), and the three states render as three distinct labels rather
   * than collapsing "never checked" and "confirmed elsewhere" into one
   * generic word:
   *
   *   | `matched` | Row |
   *   |---|---|
   *   | `true`  | `GPS matched · mask on (N arcs)` / `mask off` |
   *   | `null`  | `GPS unverified · mask on (N arcs)` / `mask off` |
   *   | `false` | `GPS mismatch · mask not applied` |
   *
   * `undefined` (every caller until TonightScreen.tsx threads the real
   * value — see this file's own hand-off note) degrades to the same
   * treatment as `null`: an honest "never checked" default, not a guess,
   * and exactly today's only observed real state.
   */
  gpsMatched?: boolean | null
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
  /**
   * Slice 3's Live nav row. Unlike `verdict` (Tonight) and
   * `projectsNeedsData` (Projects), this is a pre-computed tone/meta pair
   * rather than a raw domain value Sidebar maps itself — LiveScreen's own
   * phase (`loading`/`bridge-down`/`idle`/`active`) is a live-session
   * concept Sidebar has no reason to know about, so LiveScreen does that
   * mapping once (see its `sidebarStatus` helper) and hands over just the
   * dot tone and the row's meta text. `null` — the default, and what every
   * screen other than the mounted LiveScreen passes — renders `idle` with a
   * dash, the same "not this screen's concern right now" default the other
   * two props already use.
   */
  liveTone?: DotTone | null
  liveMeta?: string | null
}

export function Sidebar({
  site,
  verdict,
  gpsMatched = null,
  view,
  onNavigate,
  projectsHeadline = null,
  projectsNeedsData = null,
  liveTone = null,
  liveMeta = null,
}: SidebarProps) {
  const profile = site?.profile
  // `undefined` (not yet threaded by a caller) collapses to `null` — see
  // gpsMatched's own doc comment.
  const matched = gpsMatched ?? null
  const gpsLabel = matched === true ? 'GPS matched' : matched === false ? 'GPS mismatch' : 'GPS unverified'

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
            : item.view === 'live'
              ? (liveTone ?? 'idle')
              : item.view === 'projects' && projectsNeedsData !== null
                ? projectsNeedsData > 0
                  ? 'marginal'
                  : 'pass'
                : 'idle'
        const meta = disabled
          ? item.disabledLabel
          : item.view === 'tonight'
            ? (verdict ?? '—')
            : item.view === 'live'
              ? (liveMeta ?? '—')
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
              README.md:249-250. Three distinct states, not a binary — see
              SidebarProps.gpsMatched's doc comment for the mapping and its
              source verification. Never the full warning sentence, which
              stays VerdictBanner's job alone. */}
          <div className={matched === true ? styles.okRow : styles.warnRow}>
            <Dot tone={matched === true ? 'pass' : 'marginal'} size="sm" />
            <span>
              {gpsLabel} ·{' '}
              {matched === false
                ? 'mask not applied'
                : `mask ${
                    profile.horizon_mask.length > 0
                      ? `on (${profile.horizon_mask.length} arcs)`
                      : 'off'
                  }`}
            </span>
          </div>
        </div>
      )}
    </nav>
  )
}
