const STORAGE_KEY = 'seestar-dashboard:selected-project:v1'

/**
 * Which project card is selected, persisted in localStorage so a round trip
 * to another screen and back (App.tsx unmounts ProjectsScreen entirely — see
 * view.ts) doesn't reset the selection to the highest-hours default and
 * re-scope SessionHistory away from whatever the user was actually looking
 * at. Purely a client-side view preference, same category as doubling.ts's
 * goal-doubling toggle — nothing here calls the sidecar.
 *
 * Defensive on both read and write against localStorage being entirely
 * unavailable — some browsers throw on the `window.localStorage` *property
 * access* itself in a locked-down/private context, not only on `.getItem` —
 * and against the stored value being non-JSON or the wrong shape (a manual
 * edit, a future version writing a different shape). Any of those degrade to
 * "no persisted selection" / "the selection didn't persist" rather than
 * crashing the screen. A persisted id that no longer matches any fetched
 * project (a stale value from a target that's since dropped out of both
 * sources) is the caller's problem, not this module's — ProjectsScreen
 * already falls back to its own default whenever `find()` comes up empty.
 */
export function readSelectedProjectId(): string | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'string' ? parsed : null
  } catch {
    return null
  }
}

export function writeSelectedProjectId(targetId: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(targetId))
  } catch {
    // Unavailable, blocked, or over quota — the caller's own React state
    // still reflects the selection for the rest of this session; it just
    // won't survive a reload or remount. No crash either way.
  }
}
