import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LivePreviewSchema, ViewStateSchema } from '../../api/schemas'
import { PreviewCard } from './PreviewCard'
import { shareReasonLabel } from './shareReasons'
import { MONTH_ABBR } from './timestamps'
import {
  livePreviewNone,
  livePreviewStacked,
  livePreviewStale,
  livePreviewSub,
  recordedViewState,
} from '../../test/fixtures'

/**
 * PreviewCard, and specifically the absent state it was failing to reach.
 *
 * The card guarded on `preview.url` to decide whether to render an `<img>`.
 * `url` is a STATIC ROUTE PATH — `_live_preview_absent()` in routes.py sets it
 * unconditionally — so it is present even when there is no frame at all. The
 * card rendered an image at a URL that 404s, showing a broken-image icon, and
 * the honest "share unreachable" state below it never appeared.
 *
 * Every test passed, because `live_preview_none.json` omitted `url` and no
 * real response ever does. Two defects, one visible: a wrong guard, and a
 * fixture that disagreed with the server in exactly the way that hid it.
 *
 * Found by opening the screen against a live scope whose share was
 * unreachable. It could not have been found from the test suite while the
 * fixture was wrong — which is the argument for both this file and for
 * re-recording fixtures against reality.
 */
describe('PreviewCard absent state', () => {
  it('shows the reason, not a broken image, when there is no frame', () => {
    const preview = LivePreviewSchema.parse(livePreviewNone())

    render(<PreviewCard preview={preview} annotate={null} />)

    expect(screen.getByTestId('preview-empty')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('does not render an image merely because a url is present', () => {
    // The exact live payload that produced the broken icon: a real `url`
    // alongside `source: null`. This is what the server sends when the SMB
    // share cannot be reached mid-session.
    const preview = LivePreviewSchema.parse({
      ok: true,
      source: null,
      captured_at: null,
      stack_count: null,
      target: null,
      stale: false,
      reason: 'share_unreachable',
      url: '/api/live_preview/image',
    })

    render(<PreviewCard preview={preview} annotate={null} />)

    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    // Translated, never the wire token — the sidecar's own rule ("the
    // wording a user reads is the UI's job"). This used to assert the raw
    // code was shown.
    expect(screen.getByTestId('preview-empty')).toHaveTextContent(shareReasonLabel('share_unreachable'))
    expect(screen.queryByText('share_unreachable')).not.toBeInTheDocument()
  })

  it.each(['idle', 'bridge_down', 'not_configured', 'share_unreachable', 'no_frame'])(
    'renders the live_preview reason %s as prose, not as the wire code',
    (reason) => {
      const preview = LivePreviewSchema.parse({ ...(livePreviewNone() as object), reason })
      render(<PreviewCard preview={preview} annotate={null} />)
      expect(screen.getByTestId('preview-empty')).not.toHaveTextContent(reason)
      expect(screen.getByTestId('preview-empty')).toHaveTextContent(shareReasonLabel(reason))
    },
  )

  it('renders nothing-available text when the fetch itself failed', () => {
    render(<PreviewCard preview={null} annotate={null} />)

    expect(screen.getByTestId('preview-empty')).toBeInTheDocument()
  })
})

describe('PreviewCard plate-solve overlay', () => {
  // jsdom lays nothing out, so the image box reports 0×0. Give it the real
  // one: the 286 px card less its 1 px borders, by the 300 px image well.
  const realWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
  const realHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 284 })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 300 })
  })
  afterEach(() => {
    if (realWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', realWidth)
    if (realHeight) Object.defineProperty(HTMLElement.prototype, 'clientHeight', realHeight)
  })

  const recordedView = () => ViewStateSchema.parse(recordedViewState()).view_state!.result!.View!
  const stacked = () => LivePreviewSchema.parse(livePreviewStacked())
  const withAnnotation = (pixelx: number, pixely: number) => {
    const annotate = recordedView().Stack!.Annotate!
    return {
      ...annotate,
      result: { ...annotate.result, annotations: [{ type: 'ngc', names: ['NGC 7380'], pixelx, pixely, radius: 300 }] },
    }
  }

  it('places the marker where the solve is on the cropped image, not as a share of the box', () => {
    // object-fit: cover crops ~102 px off the top and bottom of the 9:16
    // frame. The marker used to sit at pixely/1920 of the box — ~25 px too
    // high on the recorded NGC 7380 solve.
    const view = recordedView()
    render(<PreviewCard preview={stacked()} annotate={view.Stack!.Annotate!} targetName={view.target_name} />)
    fireEvent.click(screen.getByRole('button', { name: /show plate-solve overlay/i }))

    const marker = screen.getByTestId('preview-target-marker')
    expect(parseFloat(marker.style.top)).toBeCloseTo(210.7, 0)
    expect(parseFloat(marker.style.left)).toBeCloseTo(81.3, 0)
  })

  it('draws no marker for a solve that falls in the cropped-away band', () => {
    render(<PreviewCard preview={stacked()} annotate={withAnnotation(540, 40)} targetName="NGC7380" />)
    fireEvent.click(screen.getByRole('button', { name: /show plate-solve overlay/i }))

    expect(screen.getByTestId('preview-overlay')).toBeInTheDocument()
    expect(screen.queryByTestId('preview-target-marker')).not.toBeInTheDocument()
    // The readout still reports it: it is in the frame, just not in view.
    expect(screen.getByTestId('framing-readout')).toHaveTextContent('in frame')
  })

  it('does not frame against an annotation that is not the target', () => {
    render(<PreviewCard preview={stacked()} annotate={withAnnotation(309, 1190)} targetName="M27" />)
    fireEvent.click(screen.getByRole('button', { name: /show plate-solve overlay/i }))

    expect(screen.queryByTestId('preview-target-marker')).not.toBeInTheDocument()
    expect(screen.queryByTestId('framing-readout')).not.toBeInTheDocument()
    expect(screen.getByText(/did not name M27/)).toBeInTheDocument()
  })

  it('takes the frame dimensions from the solve\'s own image_size', () => {
    const annotate = recordedView().Stack!.Annotate!
    const half = { ...annotate, result: { ...annotate.result, image_size: [540, 960], annotations: [{ names: ['NGC 7380'], pixelx: 270, pixely: 480 }] } }
    render(<PreviewCard preview={stacked()} annotate={half} targetName="NGC7380" />)

    expect(screen.getByText('540 × 960')).toBeInTheDocument()
    expect(screen.getByTestId('framing-readout')).toHaveTextContent('frame centre 270, 480')
  })
})

describe('PreviewCard dates a stale frame', () => {
  afterEach(() => vi.useRealTimers())

  const stale = (captured_at: string) =>
    LivePreviewSchema.parse({ ...(livePreviewStale() as object), captured_at })

  it('says which day a stale frame is from when it is not today', () => {
    // "stale — from 21:14" on a frame from last week reads as tonight.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-23T12:00:00Z'))
    const iso = '2026-07-30T02:00:00Z'
    const d = new Date(Date.parse(iso))

    render(<PreviewCard preview={stale(iso)} annotate={null} />)

    expect(screen.getByTestId('preview-stale')).toHaveTextContent(`${d.getDate()} ${MONTH_ABBR[d.getMonth()]}`)
  })

  it('never renders "Invalid Date" for a timestamp it cannot parse', () => {
    render(<PreviewCard preview={stale('not a time')} annotate={null} />)

    expect(screen.getByTestId('preview-stale')).not.toHaveTextContent(/Invalid Date/)
    expect(screen.getByTestId('preview-stale')).toHaveTextContent(/unknown time/)
  })
})

describe('PreviewCard with a frame', () => {
  it('renders the image when a sub is available', () => {
    const preview = LivePreviewSchema.parse(livePreviewSub())

    render(<PreviewCard preview={preview} annotate={null} />)

    expect(screen.getByRole('img')).toBeInTheDocument()
    expect(screen.queryByTestId('preview-empty')).not.toBeInTheDocument()
  })

  it('says out loud that a sub is a single frame, not the stack', () => {
    // A grainy 10 s frame must not be left to imply a bad result on its own.
    const preview = LivePreviewSchema.parse(livePreviewSub())

    render(<PreviewCard preview={preview} annotate={null} />)

    expect(screen.getByTestId('preview-source-sub')).toBeInTheDocument()
  })

  it('takes the sub length from the running exposure rather than assuming 10 s', () => {
    const preview = LivePreviewSchema.parse(livePreviewSub())

    render(<PreviewCard preview={preview} annotate={null} exposureMs={5_000} />)

    expect(screen.getByTestId('preview-source-sub')).toHaveTextContent('single 5 s sub — not the accumulating stack')
  })

  it('names no length it was not told — no exposure, or a stale frame from an earlier session', () => {
    const { unmount } = render(
      <PreviewCard preview={LivePreviewSchema.parse(livePreviewSub())} annotate={null} exposureMs={null} />,
    )
    expect(screen.getByTestId('preview-source-sub')).toHaveTextContent('single sub — not the accumulating stack')
    unmount()

    render(<PreviewCard preview={LivePreviewSchema.parse(livePreviewStale())} annotate={null} exposureMs={10_000} />)
    expect(screen.getByTestId('preview-source-sub')).not.toHaveTextContent(/\d s sub/)
  })

  it('renders a stacked frame without the single-sub caveat', () => {
    const preview = LivePreviewSchema.parse(livePreviewStacked())

    render(<PreviewCard preview={preview} annotate={null} />)

    expect(screen.getByRole('img')).toBeInTheDocument()
    expect(screen.queryByTestId('preview-source-sub')).not.toBeInTheDocument()
  })
})
