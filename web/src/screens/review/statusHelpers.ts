import type { QaAnalysisResponse } from '../../api/schemas'

/**
 * Screen-state helpers shared by the desktop and mobile Review layouts — see
 * ReviewStates.tsx for the components built on them. Kept apart from those
 * components so each file exports only one kind of thing.
 */

/** Is there a report to render? A finished status is not enough — a
 * `complete`/`stale` response can arrive without its `report`. */
export function hasReport(status: QaAnalysisResponse | null): boolean {
  return (
    status != null &&
    (status.status === 'complete' || status.status === 'stale') &&
    status.report != null
  )
}

/**
 * The screen's error, when it is not already the subject of AnalysisState: a
 * refused start (HTTP 429), or a report that could not be fetched after a
 * cached start. A status that could not be read is AnalysisState's whole
 * message, and on a failed status AnalysisState shows both the job's error
 * and this one (a refused or timed-out "Try again") beside its button —
 * neither is repeated here.
 */
export function errorNoteText(
  error: string | null,
  status: QaAnalysisResponse | null,
): string | null {
  if (error == null || status == null || status.status === 'failed') return null
  return error
}

/** "analysed 2026-08-01 22:00 UTC" — the server's own timestamp, trimmed. */
export function analysedLabel(analysedAt: string | null): string {
  return analysedAt ? `analysed ${analysedAt.slice(0, 16).replace('T', ' ')} UTC` : 'analysed'
}
