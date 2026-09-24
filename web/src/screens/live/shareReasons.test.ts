import { describe, expect, it } from 'vitest'
import { lastStackReasonLabel } from './lastStack'
import { shareReasonLabel } from './shareReasons'

/** The sidecar's live-share reason tokens: live_preview.py's REASON_*
 * constants, which last_stack.py reuses and adds `no_stack` to. */
const TOKENS = [
  'idle',
  'bridge_down',
  'not_configured',
  'share_unreachable',
  'scan_slow',
  'no_frame',
  'no_stack',
]

describe('shareReasonLabel', () => {
  it.each(TOKENS)('translates %s into prose', (token) => {
    const label = shareReasonLabel(token)
    expect(label).not.toBe(token)
    expect(label).not.toMatch(/_/)
  })

  it('tells "nothing written yet" apart from "cannot reach the share"', () => {
    // live_preview.py keeps them distinct on purpose: one means give it a
    // few seconds, the other means go check the network.
    expect(shareReasonLabel('no_frame')).not.toBe(shareReasonLabel('share_unreachable'))
  })

  it('does not call a share that answered slowly unreachable', () => {
    // Found on hardware after a 1003-sub night: the share listed its root in
    // 0.08 s while the scan ran past its budget, and the panel said
    // "unreachable". scan_slow means the share answered.
    expect(shareReasonLabel('scan_slow')).not.toBe(shareReasonLabel('share_unreachable'))
    expect(shareReasonLabel('scan_slow')).not.toMatch(/unreachable/i)
  })

  it('falls back to the code itself for a token it does not know — loud, not blank', () => {
    expect(shareReasonLabel('future_code')).toBe('future_code')
  })

  it('is the one map last_stack translates through too', () => {
    for (const token of TOKENS) expect(lastStackReasonLabel(token)).toBe(shareReasonLabel(token))
  })
})
