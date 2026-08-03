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

  it('draws the cutoff lines from the payload, with the real numbers', async () => {
    // These come from summary.thresholds (seestar-mcp d555c4b) — the effective
    // cutoffs this session was scored against. Asserting the VALUES, not just
    // that lines exist, is the point: a line drawn from a hardcoded constant
    // would look identical on screen.
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

    const { eccentricity_reject, eccentricity_marginal, star_count_floor } =
      realReport.summary.thresholds
    expect(await screen.findByText(`reject ${eccentricity_reject}`)).toBeInTheDocument()
    expect(await screen.findByText(`marginal ${eccentricity_marginal}`)).toBeInTheDocument()
    // The star-count chart gets a FLOOR, labelled as one — the opposite sense
    // to the eccentricity ceilings, and a label with the direction wrong
    // would be worse than no label.
    expect(await screen.findByText(`floor ${star_count_floor}`)).toBeInTheDocument()
  })

  it('renders a pre-thresholds report without lines rather than failing', async () => {
    // A report cached before d555c4b has no `thresholds` key. It must still
    // render — the numbers in it are all still true — just without cutoffs.
    const older = {
      ...realReport,
      summary: { ...realReport.summary, thresholds: undefined },
    }
    stubFetch({
      qa_analysis_status: {
        ok: true,
        target_id: 'M81',
        sub_count: 25,
        status: 'complete',
        analysed_at: '2026-08-01T01:15:00+00:00',
        report: older,
      },
    })
    render_()

    fireEvent.click(await screen.findByRole('button', { name: /M 81/ }))

    expect(await screen.findByText(/of 25 subs · 76.0%/)).toBeInTheDocument()
    expect(screen.queryByText(/^reject 0\./)).not.toBeInTheDocument()
  })
})

describe('the start response must actually parse', () => {
  it('renders the running state from a real start payload', async () => {
    // This is the bug clicking the button found. `qa_analysis_start` omitted
    // `sub_count` while `qa_analysis_status` included it, one schema
    // described both, and every start response was rejected — the browser
    // showed a parse error while the job it had just launched ran to
    // completion behind it.
    //
    // The existing tests could not catch it: they assert the route was
    // CALLED, and the fetch stub returned a generic {ok:true} that nothing
    // parsed. Asserting a call is not asserting a contract.
    stubFetch({
      qa_analysis_start: {
        ok: true,
        target_id: 'M81',
        sub_count: 587,
        status: 'running',
        started_at: '2026-08-02T01:15:00+00:00',
        elapsed_seconds: 0.4,
      },
    })
    render_()

    fireEvent.click(await screen.findByRole('button', { name: /M 81/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Analyse 587 subs/ }))

    expect(await screen.findByText(/Analysing 587 subs/)).toBeInTheDocument()
    expect(screen.queryByText(/unexpected payload/i)).not.toBeInTheDocument()
  })

  it('a start response missing sub_count is rejected loudly', async () => {
    // Pins the shape rather than the symptom: if the two routes diverge
    // again this fails here as well as in the sidecar paired-shape test.
    stubFetch({
      qa_analysis_start: {
        ok: true,
        target_id: 'M81',
        status: 'running',
        started_at: '2026-08-02T01:15:00+00:00',
        elapsed_seconds: 0.4,
      },
    })
    render_()

    fireEvent.click(await screen.findByRole('button', { name: /M 81/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Analyse 587 subs/ }))

    expect(await screen.findByText(/unexpected payload/i)).toBeInTheDocument()
  })
})

const completeReport = () => ({
  qa_analysis_status: {
    ok: true,
    target_id: 'M81',
    sub_count: 25,
    status: 'complete',
    analysed_at: '2026-08-02T01:15:00+00:00',
    report: realReport,
  },
})

describe('verdict filter', () => {
  const openReport = async () => {
    stubFetch(completeReport())
    render_()
    fireEvent.click(await screen.findByRole('button', { name: /M 81/ }))
    await screen.findByText(/of 25 subs/)
  }

  it('offers a chip per policy verdict, each carrying its own count', async () => {
    await openReport()

    for (const label of ['REJECT', 'MARGINAL', 'PASS']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${label}`) })).toBeInTheDocument()
    }
  })

  it('starts with nothing hidden', async () => {
    await openReport()

    for (const label of ['REJECT', 'MARGINAL', 'PASS']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${label}`) })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
    }
  })

  it('hides a verdict from the table when its chip is switched off', async () => {
    await openReport()
    const before = screen.getAllByText('PASS').length

    fireEvent.click(screen.getByRole('button', { name: /^PASS/ }))

    // The chip itself still says PASS, so the count drops rather than zeroing.
    expect(screen.getAllByText('PASS').length).toBeLessThan(before)
    expect(screen.getByRole('button', { name: /^PASS/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('says how many are hidden rather than quietly showing fewer', async () => {
    // A filtered table that just gets shorter looks like a smaller session.
    await openReport()

    fireEvent.click(screen.getByRole('button', { name: /^PASS/ }))

    expect(await screen.findByText(/in the session/)).toBeInTheDocument()
  })

  it('does not filter the charts — only the table', async () => {
    // A chart of only the rejects is not a picture of the night. The cutoff
    // lines and their labels must survive any filter.
    await openReport()
    fireEvent.click(screen.getByRole('button', { name: /^PASS/ }))
    fireEvent.click(screen.getByRole('button', { name: /^MARGINAL/ }))

    const { eccentricity_reject } = realReport.summary.thresholds
    expect(screen.getByText(`reject ${eccentricity_reject}`)).toBeInTheDocument()
  })
})

describe('sub image', () => {
  it('opens the scope thumbnail when a row is clicked', async () => {
    stubFetch(completeReport())
    render_()
    fireEvent.click(await screen.findByRole('button', { name: /M 81/ }))
    await screen.findByText(/of 25 subs/)

    const firstSub = realReport.summary.subs[0]
    fireEvent.click(screen.getByTitle(firstSub.name))

    const card = await screen.findByTestId('sub-image-card')
    const img = card.querySelector('img')!
    // Encoded, because real sub names contain spaces.
    expect(img.getAttribute('src')).toBe(
      `/api/sub_image/M81/${encodeURIComponent(firstSub.name)}`,
    )
  })

  it('labels the image as a thumbnail, not the sub', async () => {
    // Judging focus from a 250px JPEG is exactly the misread this prevents.
    stubFetch(completeReport())
    render_()
    fireEvent.click(await screen.findByRole('button', { name: /M 81/ }))
    await screen.findByText(/of 25 subs/)
    fireEvent.click(screen.getByTitle(realReport.summary.subs[0].name))

    expect(await screen.findByText(/not fine focus/)).toBeInTheDocument()
  })

  it('closes again', async () => {
    stubFetch(completeReport())
    render_()
    fireEvent.click(await screen.findByRole('button', { name: /M 81/ }))
    await screen.findByText(/of 25 subs/)
    fireEvent.click(screen.getByTitle(realReport.summary.subs[0].name))
    await screen.findByTestId('sub-image-card')

    fireEvent.click(screen.getByLabelText('Close sub preview'))

    expect(screen.queryByTestId('sub-image-card')).not.toBeInTheDocument()
  })
})

describe('the target list keeps up with the analysis', () => {
  it('flips the row to analysed without a page reload', async () => {
    // The bug: /api/qa_targets is fetched once on mount and never again, so a
    // target analysed during this visit kept saying "not analysed" in the
    // list while its finished report rendered beside it. Only a reload agreed
    // with itself.
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

    // Anchored: once a report renders, the sub rows are buttons too and this
    // fixture's sub names contain "M 81" ("Light_M 81_10.0s_IRCUT_...").
    const pickerRow = () => screen.getByRole('button', { name: /^M 81/ })

    await waitFor(() => expect(pickerRow()).toHaveTextContent('not analysed'))

    fireEvent.click(pickerRow())
    await screen.findByText(/of 25 subs/)

    // NOT toHaveTextContent('analysed') — "not analysed" contains it, so that
    // assertion would pass without the fix.
    await waitFor(() => expect(pickerRow()).not.toHaveTextContent('not analysed'))
    expect(pickerRow()).toHaveTextContent('analysed')
  })

  it('leaves other rows alone', async () => {
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

    fireEvent.click(await screen.findByRole('button', { name: /^M 81/ }))
    await screen.findByText(/of 25 subs/)

    // M42 was already complete in the listing and must not be rewritten by
    // M81's status.
    expect(screen.getByRole('button', { name: /^M 42/ })).toHaveTextContent('analysed')
  })
})

describe('adversarial-review regressions', () => {
  const complete = (over = {}) => ({
    qa_analysis_status: {
      ok: true,
      target_id: 'M81',
      sub_count: 25,
      status: 'complete',
      analysed_at: '2026-08-02T01:15:00+00:00',
      report: realReport,
      ...over,
    },
  })

  it('starts an analysis with POST and the client header, never a bare GET', async () => {
    // The hole this closed: as a GET, any page the user had open could spawn
    // minutes of CPU with <img src=".../qa_analysis_start?target=M31">. CORS
    // does not stop the request being sent.
    stubFetch()
    render_()

    fireEvent.click(await screen.findByRole('button', { name: /^M 81/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Analyse 587 subs/ }))

    await waitFor(() => {
      const call = (globalThis.fetch as unknown as { mock: { calls: [string, RequestInit?][] } })
        .mock.calls.find(([u]) => u.includes('qa_analysis_start'))
      expect(call).toBeDefined()
      // Bind the init before indexing into it. `call![1]?.headers[...]` reads
      // as safe and is not: the optional chain short-circuits to undefined and
      // the index then throws a TypeError, which inside waitFor() is retried
      // until timeout and surfaces as "timed out" rather than as the assertion
      // that actually failed.
      const init = call?.[1]
      expect(init).toBeDefined()
      expect(init!.method).toBe('POST')
      expect((init!.headers as Record<string, string>)['X-Seestar-Client']).toBeTruthy()
    })
  })

  it('offers a way out of a stale report instead of stranding the user', async () => {
    // A stale report used to be a dead end: Analyse buttons existed only in
    // the not_analysed and failed branches, so new subs arriving — an
    // ordinary event — left obsolete numbers on screen with no refresh.
    stubFetch(complete({ status: 'stale' }))
    render_()

    fireEvent.click(await screen.findByRole('button', { name: /^M 81/ }))

    expect(await screen.findByText('STALE')).toBeInTheDocument()
    expect(
      await screen.findByRole('button', { name: /Re-analyse 587 subs/ }),
    ).toBeInTheDocument()
  })

  it('does not carry an open sub across a target change', async () => {
    // openSub held only the sub, so switching target paired the NEW target's
    // id with the OLD target's sub — wrong metrics under the wrong heading,
    // and an image URL for a sub that target does not contain.
    stubFetch(complete())
    render_()

    fireEvent.click(await screen.findByRole('button', { name: /^M 81/ }))
    await screen.findByText(/of 25 subs/)
    fireEvent.click(screen.getByTitle(realReport.summary.subs[0].name))
    expect(await screen.findByTestId('sub-image-card')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^M 42/ }))

    await waitFor(() =>
      expect(screen.queryByTestId('sub-image-card')).not.toBeInTheDocument(),
    )
  })
})
