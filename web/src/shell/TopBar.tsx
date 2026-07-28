import type { SiteProfile } from '../api/schemas'
import styles from './TopBar.module.css'

interface Props {
  site: SiteProfile | null
  replay: boolean
}

/**
 * The handoff specifies three live connection pills — bridge :5555, S50 fw
 * 7.75, alt-az — fed by get_status / get_device_state. Neither tool is routed
 * in slice 1 (the sidecar allowlist only exposes assess_conditions,
 * plan_targets and get_site_profile), and the handoff itself is explicit that
 * "a stale green dot on a dead bridge is worse than no dot." So we render one
 * honest, dot-less placeholder pill instead of a decorative healthy state —
 * do not "fix" this by wiring up green dots without wiring up the tools first.
 *
 * For the same reason the session-facts slot below shows site name and Bortle
 * from get_site_profile rather than the design's batt/eMMC figures, which
 * need get_device_state.
 */
export function TopBar({ site, replay }: Props) {
  return (
    <header className={styles.bar}>
      <div className={styles.brand}>
        <span className={styles.wordmark}>seestar</span>
        <span className={styles.version}>mcp 0.1.0</span>
      </div>
      <div className={styles.divider} />
      <span className={styles.pill}>telemetry in slice 3</span>
      <div className={styles.spacer} />
      {site && (
        <div className={styles.facts}>
          <span>
            site <span className={styles.factValue}>{site.profile.name}</span>
          </span>
          <span>
            bortle <span className={styles.factValue}>{site.profile.bortle ?? '—'}</span>
          </span>
        </div>
      )}
      {replay && <span className={styles.replay}>fixtures — not live</span>}
    </header>
  )
}
