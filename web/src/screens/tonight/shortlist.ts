import type { PlanTarget } from '../../api/schemas'

/**
 * The design's example chain is exactly 3 ids long (`SH2-142 → M31 → M45`) —
 * it never shows what happens at more. `plan_targets` takes a `limit`
 * between 1 and 50, and TonightScreen currently requests 12, so the chain
 * must degrade gracefully rather than being tuned to whatever count the
 * fixture happens to carry. Measured live in a browser at a 1427px viewport:
 * the full 12-id chain still fits on one line there, but the rationale — not
 * the chain — is the part that carries information at any count ("why this
 * order, what it costs"), and an unbounded chain (50 ids ≈ 400+ characters)
 * would wrap regardless of viewport. Capping the chain and folding the rest
 * into a count keeps the line's width bounded independent of `limit`.
 */
const CHAIN_CAP = 3

/**
 * The ranked-shortlist section header's order line (README.md:346-347):
 * `Order: SH2-142 → M31 → M45 · earliest-setting first, 2 slews`. Both parts
 * are derived client-side from data already on the page — no server field
 * needed. The order IS `plan_targets`' own array order (the ranker already
 * sorted it; this just names what's already true of the grid below), and the
 * slew count is `targets.length - 1` (one slew between each consecutive
 * pair, none before the first or after the last) — computed from the full
 * list regardless of how much of the chain is shown.
 */
export function shortlistOrderLabel(targets: PlanTarget[]): string {
  const ids = targets.map((target) => target.id)
  const chain =
    ids.length > CHAIN_CAP
      ? [...ids.slice(0, CHAIN_CAP), `+${ids.length - CHAIN_CAP} more`].join(' → ')
      : ids.join(' → ')
  const slews = Math.max(targets.length - 1, 0)
  return `Order: ${chain} · earliest-setting first, ${slews} slew${slews === 1 ? '' : 's'}`
}
