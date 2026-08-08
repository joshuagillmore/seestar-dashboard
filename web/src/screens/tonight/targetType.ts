/**
 * The type chip is presentation, not a verdict or a threshold — the design's
 * card-data table (README.md:376-377) shows a coarse family label (`nebula`,
 * `galaxy`, `cluster`), not the server's snake_case TARGET_TYPES enum
 * (`planetary_nebula`, `globular_cluster`, …). Relabelling a fixed,
 * server-owned vocabulary for display is a client concern the same way the
 * dew-risk tone map in VerdictBanner is; it does not decide anything the
 * server didn't already decide by choosing the type.
 *
 * The eight values come from `seestar_mcp.planning.catalog.TARGET_TYPES`
 * (verified directly against that source 2026-07-30): emission_nebula,
 * planetary_nebula, reflection_nebula, supernova_remnant, galaxy,
 * open_cluster, globular_cluster, other. Kept in one place so nothing else
 * in the UI reimplements this mapping.
 *
 * Anything this map doesn't recognise — a 9th type added server-side before
 * this map is updated — falls through to the raw string with underscores
 * swapped for spaces, so the chip renders something legible rather than a
 * blank or a crash. This is a fallback for staleness, not a way to avoid
 * keeping the map current.
 */
const FAMILY: Record<string, string> = {
  emission_nebula: 'nebula',
  planetary_nebula: 'nebula',
  reflection_nebula: 'nebula',
  supernova_remnant: 'nebula',
  galaxy: 'galaxy',
  open_cluster: 'cluster',
  globular_cluster: 'cluster',
  other: 'other',
}

export function targetTypeLabel(type: string): string {
  return FAMILY[type] ?? type.replace(/_/g, ' ')
}
