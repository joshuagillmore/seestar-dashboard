/**
 * A target handed to the Review & QA screen by another screen.
 *
 * The Projects grid's quality bar navigates here with a target already in
 * mind. There is no router and no shared store — navigation is a `View`
 * string in App state (design/README.md § State Management) — so the target
 * itself needs somewhere to travel.
 *
 * `sessionStorage`, not `localStorage`, and it is **consumed once**. Both
 * choices are about not resurrecting an intent:
 *
 * - session-scoped, so it dies with the tab rather than reopening a report
 *   the next time the app is launched;
 * - `take()` clears as it reads, so navigating to Review by clicking the nav
 *   rail afterwards does not silently reopen the last target someone
 *   arrived at from Projects.
 *
 * Mirrors `screens/projects/selection.ts`, which persists the Projects grid's
 * own selection — same never-throw discipline, because a browser with storage
 * blocked must degrade to "no preselection" rather than break the screen.
 */
const STORAGE_KEY = 'seestar.review.pendingTarget'

/** Read and clear. Returns `null` when nothing is pending, storage is
 * unavailable, or the stored value is not a string. */
export function takePendingReviewTarget(): string | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    window.sessionStorage.removeItem(STORAGE_KEY)
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'string' ? parsed : null
  } catch {
    return null
  }
}

export function setPendingReviewTarget(targetId: string): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(targetId))
  } catch {
    // Storage unavailable, blocked or full. The navigation still happens; the
    // user lands on Review with nothing preselected, which is the screen's
    // ordinary opening state rather than an error.
  }
}
