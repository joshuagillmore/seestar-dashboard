import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { ReviewScreen } from './ReviewScreen'
import { SiteProfileSchema, type Health } from '../../api/schemas'
import { stubMatchMedia } from '../../test/matchMedia'
import { recordedSite } from '../../test/fixtures'

const site = SiteProfileSchema.parse(recordedSite())
const notReplaying: Health = { ok: true, replay: false }

const realReport = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../fixtures/qa_tier2.subs.json'), 'utf-8'),
)

const TARGETS = {
  ok: true,
  archive_status: { configured: true, path: '/archive', exists: true, target_count: 2 },
  targets: [
    { target_id: 'M81', display_name: 'M 81', sub_count: 587, status: 'not_analysed' },
    {
      target_id: 'M42',
      display_name: 'M 42',
      sub_count: 1204,
      status: 'complete',
      analysed_at: '2026-08-02T01:15:00+00:00',
    },
  ],
}

/** Records every URL fetched, so a test can assert what was NOT called. */
let calls: string[] = []

function stubFetch(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      for (const [fragment, body] of Object.entries(overrides)) {
        if (url.includes(fragment)) {
          return new Response(JSON.stringify(body), { status: 200 })
        }
      }
      if (url.includes('/api/qa_targets')) {
        return new Response(JSON.stringify(TARGETS), { status: 200 })
      }
      if (url.includes('/api/qa_analysis_status')) {
        return new Response(
          JSON.stringify({ ok: true, target_id: 'M81', sub_count: 587, status: 'not_analysed' }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }),
  )
}

const render_ = () =>
  render(
    <ReviewScreen view="review" onNavigate={vi.fn()} site={site} health={notReplaying} />,
  )

beforeEach(() => {
  calls = []
  stubMatchMedia(false)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/**
 * The load discipline is the point of these tests.
 *
 * `qa_tier2` is minutes long over a real target. CLAUDE.md and the slice-4
 * spec both say it plainly: **do not start an analysis on a page load, ever.**
 * That is a property worth a test rather than a comment, because it is
 * invisible in review — a stray fetch in a `useEffect` looks like every other
 * fetch until someone opens the screen and the scope's archive starts
 * churning for four minutes.
 */
describe('ReviewScreen never starts work on its own', () => {
  it('does not call qa_analysis_start on mount', async () => {
    stubFetch()
    render_()

    await screen.findByText(/Targets/)

    expect(calls.some((u) => u.includes('qa_analysis_start'))).toBe(false)
    expect(calls.some((u) => u.includes('qa_targets'))).toBe(true)
  })

  it('does not call qa_analysis_start when a target is merely selected', async () => {
    stubFetch()
    render_()

    fireEvent.click(await screen.findByRole('button', { name: /M 81/ }))
    await waitFor(() => expect(calls.some((u) => u.includes('qa_analysis_status'))).toBe(true))

    // Selecting reads status. It must never begin a run — a click on a row is
    // "show me", not "spend four minutes".
    expect(calls.some((u) => u.includes('qa_analysis_start'))).toBe(false)
  })

  it('calls qa_analysis_start only from the explicit button', async () => {
    stubFetch()
    render_()

    fireEvent.click(await screen.findByRole('button', { name: /M 81/ }))
    const analyse = await screen.findByRole('button', { name: /Analyse 587 subs/ })
    expect(calls.some((u) => u.includes('qa_analysis_start'))).toBe(false)

    fireEvent.click(analyse)

    await waitFor(() => expect(calls.some((u) => u.includes('qa_analysis_start'))).toBe(true))
  })
})

describe('ReviewScreen states', () => {
  it('shows the sub count before anything is started', async () => {
    // The spec's honesty requirement: the user sees the scale they are
    // committing to before they commit to it.
    stubFetch()
    render_()

    expect(await screen.findByText('587 subs')).toBeInTheDocument()
    expect(await screen.findByText('1204 subs')).toBeInTheDocument()
  })

  it('reads "not analysed" as ordinary, not as a failure', async () => {
    stubFetch()
    render_()

    fireEvent.click(await screen.findByRole('button', { name: /M 81/ }))

    expect(
      await screen.findByText(/ordinary state of a fresh archive, not a problem/),
    ).toBeInTheDocument()
  })

  it('renders a real report end to end', async () => {
    stubFetch({
      qa_analysis_status: {
        ok: true,
        target_id: 'M81',
        sub_count: 25,
        status: 'complete',
        analysed_at: '2026-08-02T01:15:00+00:00',
        report: realReport,
      },
    })
    render_()

    fireEvent.click(await screen.findByRole('button', { name: /M 81/ }))

    // Stat grid off the real payload: 19 kept of 25.
    expect(await screen.findByText('19')).toBeInTheDocument()
    expect(await screen.findByText(/of 25 subs · 76.0%/)).toBeInTheDocument()
    // Verdict badges rendered verbatim from the server.
    expect((await screen.findAllByText('REJECT')).length).toBeGreaterThan(0)
    expect((await screen.findAllByText('PASS')).length).toBeGreaterThan(0)
  })

  it('marks a stale report as stale rather than presenting it as current', async () => {
    stubFetch({
      qa_analysis_status: {
        ok: true,
        target_id: 'M81',
        sub_count: 25,
        status: 'stale',
        analysed_at: '2026-08-01T22:00:00+00:00',
        report: realReport,
      },
    })
    render_()

    fireEvent.click(await screen.findByRole('button', { name: /M 81/ }))

    expect(await screen.findByText('STALE')).toBeInTheDocument()
  })

  it('says the archive is unconfigured rather than showing an empty list', async () => {
    stubFetch({
      qa_targets: {
        ok: true,
        targets: [],
        archive_status: { configured: false, path: null, exists: false, target_count: 0 },
      },
    })
    render_()

    // "No targets" and "you never told us where to look" are different
    // problems and must not render identically.
    expect(await screen.findByText(/No archive configured/)).toBeInTheDocument()
  })

  it('draws no threshold lines, and says why', async () => {
    // The design specifies dashed cutoff lines. The payload carries no
    // thresholds, and the numbers exist only inside reason prose — so the
    // lines are absent and the legend states that, rather than the screen
    // implying the cutoffs were never part of the design.
    stubFetch({
      qa_analysis_status: {
        ok: true,
        target_id: 'M81',
        sub_count: 25,
        status: 'complete',
        analysed_at: '2026-08-02T01:15:00+00:00',
        report: realReport,
      },
    })
    render_()

    fireEvent.click(await screen.findByRole('button', { name: /M 81/ }))

    expect(await screen.findByText(/payload carries no\s+thresholds/)).toBeInTheDocument()
  })
})
