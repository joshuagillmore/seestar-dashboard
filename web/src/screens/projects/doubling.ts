const STORAGE_KEY = 'seestar-dashboard:doubled-goals:v1'

/**
 * Per-target "view at double the suggested goal" toggle, persisted in
 * localStorage. Purely a client-side viewing preference: `set_project_goal`
 * is deliberately excluded from the sidecar's route allowlist (see the root
 * CLAUDE.md's hand-back rule), so this can never round-trip to the telescope
 * and must not pretend to — nothing here calls the sidecar, and the control
 * that uses this says so in its own title (see ProjectCard.tsx).
 *
 * Defensive on both read and write against localStorage being entirely
 * unavailable — some browsers throw on the `window.localStorage` *property
 * access* itself in a locked-down/private context, not only on `.getItem` —
 * and against the stored value being non-JSON or non-array junk (a manual
 * edit, a future version writing a different shape). Any of those degrade to
 * "nothing is doubled" / "the toggle didn't persist" rather than crashing
 * the screen.
 */
function readDoubledIds(): Set<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((id): id is string => typeof id === 'string'))
  } catch {
    return new Set()
  }
}

function writeDoubledIds(ids: Set<string>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(ids)))
  } catch {
    // Unavailable, blocked, or over quota — the caller's own React state
    // still reflects the toggle for the rest of this session; it just won't
    // survive a reload. No crash either way.
  }
}

export function isGoalDoubled(targetId: string): boolean {
  return readDoubledIds().has(targetId)
}

/** Flips the stored flag for one target and returns the new value. */
export function toggleGoalDoubled(targetId: string): boolean {
  const ids = readDoubledIds()
  const next = !ids.has(targetId)
  if (next) ids.add(targetId)
  else ids.delete(targetId)
  writeDoubledIds(ids)
  return next
}
