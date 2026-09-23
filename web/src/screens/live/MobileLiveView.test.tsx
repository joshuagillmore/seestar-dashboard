import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import {
  FocuserPositionSchema,
  LivePreviewSchema,
  StackStateSchema,
  Tier1Schema,
} from '../../api/schemas'
import {
  livePreviewNone,
  livePreviewStale,
  livePreviewStacked,
  livePreviewSub,
  recordedFocuserPosition,
  recordedTier1,
} from '../../test/fixtures'
import { MobileLiveView } from './MobileLiveView'
import { shareReasonLabel } from './shareReasons'
import { appendTelemetryEntry } from './telemetryLog'

const view = StackStateSchema.parse({
  stacked_frame: 211,
  dropped_frame: 0,
  // Real nesting, per firmware 7.75: the solve is inside
  // Annotate.result.annotations[], not flat on Annotate.
  Annotate: {
    state: 'complete',
    result: {
      image_size: [1080, 1920],
      annotations: [{ type: 'ngc', names: ['NGC 7380'], pixelx: 309.123, pixely: 1190.65, radius: 315.861 }],
    },
  },
})
const tier1 = Tier1Schema.parse(recordedTier1())
const focuser = FocuserPositionSchema.parse(recordedFocuserPosition())
const preview = LivePreviewSchema.parse(livePreviewStacked())

describe('MobileLiveView', () => {
  it('renders exactly three stat tiles — DROPS, FOCUS, PLATE SOLVE — never ALT or BAND', () => {
    render(
      <MobileLiveView
        targetId="M27"
        targetName="Dumbbell Nebula"
        stack={view}
        tier1={tier1}
        focuser={focuser}
        preview={preview}
        log={[]}
      />,
    )
    const tiles = screen.getByTestId('mobile-live-tiles')
    expect(tiles).toHaveTextContent('DROPS')
    expect(tiles).toHaveTextContent('FOCUS')
    expect(tiles).toHaveTextContent('PLATE SOLVE')
    // ALT/BAND need an instantaneous altitude no tool returns (handback item
    // 18) — asserting their absence, not just DROPS's presence, is what
    // would catch a placeholder tile slipping back in.
    expect(tiles).not.toHaveTextContent('ALT')
    expect(tiles).not.toHaveTextContent('BAND')
  })

  it('reads DROPS/FOCUS/PLATE SOLVE from the same real fixture values TelemetryGrid shows on desktop', () => {
    render(
      <MobileLiveView
        targetId="M27"
        targetName="Dumbbell Nebula"
        stack={view}
        tier1={tier1}
        focuser={focuser}
        preview={preview}
        log={[]}
      />,
    )
    // tier1 fixture: rejected 0, focus_pos 1830, Annotate.state "complete".
    const tiles = screen.getByTestId('mobile-live-tiles')
    expect(tiles).toHaveTextContent('0')
    expect(tiles).toHaveTextContent('1830')
    expect(tiles).toHaveTextContent('complete')
  })

  it('never renders the decision card or any of its buttons', () => {
    render(
      <MobileLiveView
        targetId="M27"
        targetName="Dumbbell Nebula"
        stack={view}
        tier1={tier1}
        focuser={focuser}
        preview={preview}
        log={[]}
      />,
    )
    expect(screen.queryByText(/Decision needed/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /approve slew/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /not yet/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows the catalogue id big and the resolved common name as a subtitle', () => {
    render(
      <MobileLiveView
        targetId="M27"
        targetName="Dumbbell Nebula"
        stack={view}
        tier1={tier1}
        focuser={focuser}
        preview={preview}
        log={[]}
      />,
    )
    expect(screen.getByText('M27')).toBeInTheDocument()
    expect(screen.getByText('Dumbbell Nebula')).toBeInTheDocument()
  })

  it('renders no subtitle — not a fabricated one — while observability has not resolved a common name yet', () => {
    render(
      <MobileLiveView
        targetId="M27"
        targetName={null}
        stack={view}
        tier1={tier1}
        focuser={focuser}
        preview={preview}
        log={[]}
      />,
    )
    expect(screen.getByText('M27')).toBeInTheDocument()
    expect(screen.queryByText('Dumbbell Nebula')).not.toBeInTheDocument()
  })

  it('shows the "· NN.N min" integration caption, computed from the scope\'s own running exposure', () => {
    // View.Stack.Exposure.exp_ms was on the real payload all along; the
    // schema dropped it, so this caption was left out as "not returned".
    const withExposure = StackStateSchema.parse({ ...view, Exposure: { state: 'complete', exp_ms: 10000 } })
    render(
      <MobileLiveView
        targetId="M27"
        targetName="Dumbbell Nebula"
        stack={withExposure}
        tier1={tier1}
        focuser={focuser}
        preview={LivePreviewSchema.parse(livePreviewSub())}
        log={[]}
      />,
    )
    // tier1's own count (115) × 10 s.
    expect(screen.getByText('stacked · 19.2 min')).toBeInTheDocument()
    expect(screen.getByTestId('mobile-preview-source-sub')).toHaveTextContent('single 10 s sub — not the stack')
  })

  it('claims no integration or sub length when the poll carried no exposure', () => {
    render(
      <MobileLiveView
        targetId="M27"
        targetName="Dumbbell Nebula"
        stack={view}
        tier1={tier1}
        focuser={focuser}
        preview={LivePreviewSchema.parse(livePreviewSub())}
        log={[]}
      />,
    )
    expect(screen.getByText('stacked')).toBeInTheDocument()
    expect(screen.getByTestId('mobile-preview-source-sub')).toHaveTextContent('single sub — not the stack')
  })

  it('drops the LP-filter/elapsed subtitle detail, and the integration caption when there is no exposure to compute it from', () => {
    render(
      <MobileLiveView
        targetId="M27"
        targetName="Dumbbell Nebula"
        stack={view}
        tier1={tier1}
        focuser={focuser}
        preview={preview}
        log={[]}
      />,
    )
    expect(screen.queryByText(/LP/)).not.toBeInTheDocument()
    expect(screen.queryByText(/elapsed/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/min$/)).not.toBeInTheDocument()
    // The stacked count itself is real and does render, just with a bare
    // "stacked" caption instead of "stacked · NN.N min".
    expect(screen.getByText('115')).toBeInTheDocument()
    expect(screen.getByText('stacked')).toBeInTheDocument()
  })

  it('marks a single-sub preview frame visibly, the same honesty rule PreviewCard enforces on desktop', () => {
    const sub = LivePreviewSchema.parse(livePreviewSub())
    render(
      <MobileLiveView
        targetId="M27"
        targetName="Dumbbell Nebula"
        stack={view}
        tier1={tier1}
        focuser={focuser}
        preview={sub}
        log={[]}
      />,
    )
    expect(screen.getByTestId('mobile-preview-source-sub')).toBeInTheDocument()
  })

  it('marks a stale preview frame visibly', () => {
    const stale = LivePreviewSchema.parse(livePreviewStale())
    render(
      <MobileLiveView
        targetId="M27"
        targetName="Dumbbell Nebula"
        stack={view}
        tier1={tier1}
        focuser={focuser}
        preview={stale}
        log={[]}
      />,
    )
    expect(screen.getByTestId('mobile-preview-stale')).toBeInTheDocument()
  })

  it('renders a live_preview reason as prose, not as the wire code', () => {
    const unreachable = LivePreviewSchema.parse({ ...(livePreviewNone() as object), reason: 'share_unreachable' })
    render(
      <MobileLiveView
        targetId="M27"
        targetName="Dumbbell Nebula"
        stack={view}
        tier1={tier1}
        focuser={focuser}
        preview={unreachable}
        log={[]}
      />,
    )
    expect(screen.getByTestId('mobile-preview-empty')).toHaveTextContent(shareReasonLabel('share_unreachable'))
    expect(screen.queryByText('share_unreachable')).not.toBeInTheDocument()
  })

  it('renders the honest empty-preview state, not a broken image, when there is no frame yet', () => {
    const none = LivePreviewSchema.parse(livePreviewNone())
    render(
      <MobileLiveView
        targetId="M27"
        targetName="Dumbbell Nebula"
        stack={view}
        tier1={tier1}
        focuser={focuser}
        preview={none}
        log={[]}
      />,
    )
    expect(screen.getByTestId('mobile-preview-empty')).toBeInTheDocument()
  })

  it('renders the log tail capped to 3 entries, newest first, with the compact micro-label and no "Quality verdict pending" caption', () => {
    let log = appendTelemetryEntry([], tier1)
    for (let i = 0; i < 4; i++) {
      log = appendTelemetryEntry(log, {
        ...tier1,
        snapshot: { ...tier1.snapshot, ts: new Date(Date.parse(tier1.snapshot.ts) + (i + 1) * 60_000).toISOString() },
      })
    }
    expect(log.length).toBe(5)

    render(
      <MobileLiveView
        targetId="M27"
        targetName="Dumbbell Nebula"
        stack={view}
        tier1={tier1}
        focuser={focuser}
        preview={preview}
        log={log}
      />,
    )
    expect(screen.getAllByTestId('telemetry-log-line')).toHaveLength(3)
    expect(screen.getByText('Tier-1 telemetry')).toBeInTheDocument()
    expect(screen.queryByText(/Quality verdict pending/i)).not.toBeInTheDocument()
  })

  it('never shows a per-sub PASS/MARGINAL/REJECT verdict', () => {
    render(
      <MobileLiveView
        targetId="M27"
        targetName="Dumbbell Nebula"
        stack={view}
        tier1={tier1}
        focuser={focuser}
        preview={preview}
        log={[]}
      />,
    )
    expect(screen.queryByText(/\bREJECT\b/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\bMARGINAL\b/)).not.toBeInTheDocument()
  })

  // Regression guard for the design's own hard requirement — see
  // MobileTonightView.test.tsx's matching guard. MobileLiveView itself has no
  // interactive elements once the decision card is dropped (see the "never
  // renders the decision card" test above), so there is nothing left here to
  // apply the 44px rule to — documented, not silently skipped.
  it('has no interactive elements at all, once the decision card is dropped — the 44px minimum has nothing to apply to here', () => {
    render(
      <MobileLiveView
        targetId="M27"
        targetName="Dumbbell Nebula"
        stack={view}
        tier1={tier1}
        focuser={focuser}
        preview={preview}
        log={[]}
      />,
    )
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })
})
