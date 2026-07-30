import type { PlanTarget } from '../../api/schemas'

/**
 * The ranked-shortlist section header's order line (README.md:320-321):
 * `Order: SH2-142 → M31 → M45 · earliest-setting first, 2 slews`. Both parts
 * are derived client-side from data already on the page — no server field
 * needed. The order IS `plan_targets`' own array order (the ranker already
 * sorted it; this just names what's already true of the grid below), and the
 * slew count is `targets.length - 1` (one slew between each consecutive
 * pair, none before the first or after the last).
 */
export function shortlistOrderLabel(targets: PlanTarget[]): string {
  const order = targets.map((target) => target.id).join(' → ')
  const slews = Math.max(targets.length - 1, 0)
  return `Order: ${order} · earliest-setting first, ${slews} slew${slews === 1 ? '' : 's'}`
}
