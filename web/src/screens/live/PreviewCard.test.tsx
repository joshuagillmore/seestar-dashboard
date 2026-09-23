import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LivePreviewSchema } from '../../api/schemas'
import { PreviewCard } from './PreviewCard'
import { MONTH_ABBR } from './timestamps'
import { livePreviewNone, livePreviewStacked, livePreviewStale, livePreviewSub } from '../../test/fixtures'

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
    expect(screen.getByText('share_unreachable')).toBeInTheDocument()
  })

  it('renders nothing-available text when the fetch itself failed', () => {
    render(<PreviewCard preview={null} annotate={null} />)

    expect(screen.getByTestId('preview-empty')).toBeInTheDocument()
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
