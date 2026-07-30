import { useEffect, useState } from 'react'
import { fetchHealth, fetchSite } from '../api/client'
import type { Health, SiteProfile } from '../api/schemas'

export interface ShellData {
  site: SiteProfile | null
  health: Health | null
}

/**
 * get_site_profile and /api/health are shell-level facts — every screen's
 * Sidebar and TopBar render them — not per-screen data. Originally each
 * screen fetched its own copy, because Tonight was the only screen and site
 * profile happened to live inside its fetch. Once Projects existed too, that
 * silently turned "app-level data" into "per-screen data": switching views
 * tore down and re-fetched the whole sidebar, blanking the site block and
 * the replay badge on every navigation. Fetched once here, in App.tsx, and
 * threaded into whichever screen is mounted, so both survive a view switch.
 *
 * Silently stays null on failure rather than surfacing its own error: there
 * is already no visual difference between "hasn't loaded yet" and "isn't
 * available" for a null site (see Sidebar's "renders without a profile" and
 * TopBar's "renders while the site profile is still loading" tests) — a
 * fetch failure here just degrades to that same already-supported absent
 * state. A screen's OWN data (conditions/plan; projects_combined/
 * list_projects) still surfaces its own fetch failures as a screen-level
 * error banner, independently of this.
 */
export function useShellData(): ShellData {
  const [site, setSite] = useState<SiteProfile | null>(null)
  const [health, setHealth] = useState<Health | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([fetchSite(), fetchHealth()])
      .then(([siteResult, healthResult]) => {
        if (!cancelled) {
          setSite(siteResult)
          setHealth(healthResult)
        }
      })
      .catch(() => {
        // See docstring above: shell-level data degrades to absent, silently.
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { site, health }
}
