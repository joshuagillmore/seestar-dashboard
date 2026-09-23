import { useEffect, useState } from 'react'
import { fetchHealth, fetchSite, type RequestOptions } from '../api/client'
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
 *
 * Null must not mean null for good, though. These are fetched once per tab,
 * and they used to be fetched once, together, with no retry: a sidecar that
 * was not up yet at first load left `site` (which gates the Live screen's
 * sweet-band gauge) and the replay badge null for the tab's whole life, and
 * Promise.all meant either route failing blanked both. Each is now loaded on
 * its own and retried with a gentle back-off (`shellRetryDelayMs`) until it
 * succeeds, then never fetched again.
 */
export function useShellData(): ShellData {
  const [site, setSite] = useState<SiteProfile | null>(null)
  const [health, setHealth] = useState<Health | null>(null)

  useEffect(() => {
    let cancelled = false
    const timers = new Set<ReturnType<typeof setTimeout>>()
    const controller = new AbortController()

    function load<T>(
      fetcher: (opts: RequestOptions) => Promise<T>,
      set: (value: T) => void,
      attempt = 0,
    ) {
      fetcher({ signal: controller.signal }).then(
        (value) => {
          if (!cancelled) set(value)
        },
        () => {
          if (cancelled) return
          const timer = setTimeout(() => {
            timers.delete(timer)
            load(fetcher, set, attempt + 1)
          }, shellRetryDelayMs(attempt))
          timers.add(timer)
        },
      )
    }

    load(fetchSite, setSite)
    load(fetchHealth, setHealth)
    return () => {
      cancelled = true
      timers.forEach(clearTimeout)
      controller.abort()
    }
  }, [])

  return { site, health }
}

/** Wait before retry `attempt` (0-based): 2 s, doubling, capped at a
 * minute. Quick enough that starting the sidecar a moment after the page
 * shows up within seconds; gentle enough that a sidecar that stays down is
 * asked about once a minute, not hammered. */
export function shellRetryDelayMs(attempt: number): number {
  return Math.min(2_000 * 2 ** attempt, 60_000)
}
