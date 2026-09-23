/**
 * The sidecar's live-share `reason` tokens, in words — one map for both
 * routes that read the scope's share:
 *
 * - `/api/live_preview` (live_preview.py's REASON_* constants): `idle`,
 *   `bridge_down`, `not_configured`, `share_unreachable`, `no_frame`
 * - `/api/last_stack` (last_stack.py reuses the first four, adds `no_stack`)
 *
 * Both modules say so explicitly: "the wording a user reads is the UI's
 * job, never this module's." PreviewCard and MobileLiveView used to render
 * `preview.reason` raw, so the user read `share_unreachable` and `no_frame`,
 * while LastStackCard translated the same family through its own private
 * map. One map now, so the two panels cannot word the same state
 * differently.
 *
 * `no_frame` and `share_unreachable` stay distinct on purpose (live_preview.py
 * again): one is "nothing written yet, give it a moment", the other "go check
 * the network". An unrecognised future token falls back to itself rather
 * than disappearing — loud, not blank.
 */
const SHARE_REASON_LABELS: Record<string, string> = {
  no_stack: 'No completed stack yet for this target.',
  no_frame: 'No frame on the live share yet.',
  idle: 'Scope not observing right now.',
  bridge_down: 'Bridge unreachable — the same connection the rest of this screen depends on.',
  not_configured: 'Live share not configured on the sidecar.',
  share_unreachable: 'Live share unreachable right now.',
}

export function shareReasonLabel(reason: string): string {
  return SHARE_REASON_LABELS[reason] ?? reason
}
