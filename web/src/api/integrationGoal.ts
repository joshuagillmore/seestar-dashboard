import type { IntegrationGoal } from './schemas'

/**
 * Maps the sidecar's integration-goal contract onto the finite set of states
 * the UI actually renders — see integration_goal.py's module docstring,
 * "The `reason` field", for the authoritative state table this mirrors:
 *
 *   | state                 | track          | reason                 |
 *   |------------------------|---------------|-------------------------|
 *   | not in the catalogue   | (whole `goal` is `null`) | —          |
 *   | no catalogued magnitude| "none"        | no_magnitude            |
 *   | photometry not credible| "none"        | photometry_unreliable   |
 *   | beyond practical reach | "photometric" | null                    |
 *   | coarse / normal        | "cluster"/"photometric" | null          |
 *
 * Shared between the Projects screen and Tonight's ranked cards so the two
 * never drift into different wording for the same underlying state. Every
 * branch here reads a field the server already computed — this only chooses
 * which honest sentence goes with it; it never derives a new number or
 * re-implements the server's own reasoning (see CLAUDE.md's hand-back rule
 * and the module docstring's own "never re-derive" instruction).
 */
export type GoalDisplay =
  | { kind: 'not-catalogued' }
  | { kind: 'no-goal'; reason: 'no_magnitude' | 'photometry_unreliable'; note: string }
  | { kind: 'beyond-reach'; note: string }
  | { kind: 'goal'; hours: number; coarse: boolean; note: string }

export function describeGoal(goal: IntegrationGoal | null): GoalDisplay {
  if (!goal || goal.track === 'none') {
    // A bare `null` (never resolved a catalogue record) and a resolved
    // target with `track: "none"` are different questions with different
    // reasons — collapsing them would lose exactly the distinction this
    // module exists to keep. `goal.reason` is guaranteed non-null whenever
    // `track === "none"` (see IntegrationGoalSchema's doc comment); the
    // `!goal.reason` fallback only guards a malformed payload.
    if (!goal || !goal.reason) return { kind: 'not-catalogued' }
    return { kind: 'no-goal', reason: goal.reason, note: goal.note }
  }
  if (goal.beyond_reach) return { kind: 'beyond-reach', note: goal.note }
  // suggested_hours is guaranteed non-null here: the only two null cases
  // (track "none" and beyond_reach) are both handled above.
  return { kind: 'goal', hours: goal.suggested_hours as number, coarse: goal.coarse, note: goal.note }
}

const NO_GOAL_TEXT: Record<'no_magnitude' | 'photometry_unreliable', string> = {
  no_magnitude: 'no catalogued magnitude',
  photometry_unreliable: 'photometry not credible',
}

export interface GoalLabel {
  text: string
  /** The server's own one-line `note`, verbatim (plus a doubling caveat when
   * applicable) — same convention as the FWHM-absent title elsewhere in this
   * app: a short visible label, with the full auditable reason a hover away. */
  title?: string
}

/**
 * The hours-row's second span: "of N h suggested", or its honest replacement
 * for a state with no number. "suggested", never "goal"/"needed"/"remaining"
 * — integration_goal.py's own docstring is explicit that this number is a
 * quality-tier choice, not a requirement, and forbids wording it as one.
 *
 * `doubled` is a pure local view multiplier (see screens/projects/doubling.ts)
 * — it changes the displayed number and the title's caveat, never requests a
 * new number from the server.
 */
export function goalLabel(goal: IntegrationGoal | null, doubled: boolean): GoalLabel {
  const display = describeGoal(goal)
  switch (display.kind) {
    case 'not-catalogued':
      return { text: 'not in DSO catalogue' }
    case 'no-goal':
      return { text: NO_GOAL_TEXT[display.reason], title: display.note }
    case 'beyond-reach':
      return { text: 'beyond practical reach', title: display.note }
    case 'goal': {
      const hours = doubled ? display.hours * 2 : display.hours
      const prefix = display.coarse ? '~' : ''
      const title = doubled
        ? `${display.note} Doubled here for viewing only — not sent to the telescope. SNR improves with the square root of exposure time, so a doubling is roughly 41% better SNR, not double the image.`
        : display.note
      return { text: `of ${prefix}${hours.toFixed(1)} h suggested`, title }
    }
  }
}

/**
 * 0-100, or `null` when there is no numeric suggested_hours to measure
 * against (not-catalogued, no-goal, beyond-reach) — the caller renders an
 * empty rail rather than a bar with a fabricated denominator.
 */
export function goalProgressPct(
  totalMinutes: number,
  goal: IntegrationGoal | null,
  doubled: boolean,
): number | null {
  const display = describeGoal(goal)
  if (display.kind !== 'goal') return null
  const suggestedMinutes = display.hours * 60 * (doubled ? 2 : 1)
  if (suggestedMinutes <= 0) return null
  return Math.min(100, Math.round((totalMinutes / suggestedMinutes) * 100))
}

/** Whether a numeric goal exists at all — gates whether the doubling toggle
 * is shown (doubling "no catalogued magnitude" makes no sense). */
export function hasNumericGoal(goal: IntegrationGoal | null): boolean {
  return describeGoal(goal).kind === 'goal'
}

/** Shared with screens/projects/projects.ts's identical one-liner — kept
 * here too so screens/tonight/PlanCard.tsx (which renders the same goal
 * data) doesn't reach across into another screen's module for one line of
 * formatting. */
export const formatHours = (minutes: number): string => `${(minutes / 60).toFixed(1)} h`
