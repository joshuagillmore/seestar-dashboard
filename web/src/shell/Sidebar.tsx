import type { SiteProfile } from '../api/schemas'
import { verdictTone, type Verdict } from '../api/verdict'
import { Dot } from '../ui/Dot'
import styles from './Sidebar.module.css'

export interface SidebarProps {
  site: SiteProfile | null
  verdict: Verdict | null
  /**
   * `location.warning` from assess_conditions, or null when the site is
   * confirmed. It does NOT live on SiteProfile — `location` is returned
   * alongside the conditions payload — so TonightScreen threads it in.
   */
  gpsWarning: string | null
}

export function Sidebar({ site, verdict, gpsWarning }: SidebarProps) {
  const profile = site?.profile

  return (
    <nav className={styles.rail}>
      <div className={styles.eyebrow}>Session</div>

      <button className={`${styles.nav} ${styles.navActive}`}>
        <Dot tone={verdict ? verdictTone(verdict) : 'idle'} />
        <span className={styles.label}>Tonight's plan</span>
        <span className={styles.meta}>{verdict ?? '—'}</span>
      </button>

      {[
        ['Live session', 'slice 3'],
        ['Review & QA', 'slice 4'],
        ['Projects', 'slice 2'],
      ].map(([label, meta]) => (
        <button key={label} className={styles.nav} disabled>
          <Dot tone="idle" />
          <span className={styles.label}>{label}</span>
          <span className={styles.meta}>{meta}</span>
        </button>
      ))}

      <div className={styles.spacer} />

      {profile && (
        <div className={styles.site}>
          <div className={styles.eyebrow}>Site profile</div>
          <div className={styles.siteName}>{profile.name}</div>
          <div className={styles.siteMeta}>
            {profile.lat_deg.toFixed(3)} N · {Math.abs(profile.lon_deg).toFixed(3)} W
          </div>
          <div className={styles.siteMeta}>
            Bortle {profile.bortle ?? '—'} · floor {profile.min_altitude_deg}° · ceiling{' '}
            {profile.field_rotation_ceiling_deg}°
          </div>
          <div className={styles.siteMeta}>
            mask {profile.horizon_mask.length > 0
              ? `on (${profile.horizon_mask.length} arcs)`
              : 'off'}
          </div>
          {/* The design shows a confident `GPS matched` row here. This
              installation has never matched — location.matched is null and the
              server sends a warning — so the row carries that warning verbatim
              in the marginal tone instead of asserting a match nobody made. */}
          <div className={gpsWarning ? styles.warnRow : styles.okRow}>
            <Dot tone={gpsWarning ? 'marginal' : 'pass'} size="sm" />
            <span>{gpsWarning ?? 'GPS matched'}</span>
          </div>
        </div>
      )}
    </nav>
  )
}
