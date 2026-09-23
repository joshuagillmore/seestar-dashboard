import { StrictMode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { ReviewScreen } from './ReviewScreen'
import { SiteProfileSchema, type Health } from '../../api/schemas'
import { stubMatchMedia } from '../../test/matchMedia'
import { recordedSite } from '../../test/fixtures'
import { setPendingReviewTarget } from './pendingTarget'
import { serverReason } from './testReasons'

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
    expect(screen.queryByText(/^reject /)).not.toBeInTheDocument()
    // The marginal line too — not only reject. A client that fell back to a
    // remembered marginal cutoff would draw exactly this one.
    expect(screen.queryByText(/^marginal /)).not.toBeInTheDocument()
    expect(screen.queryByText(/^floor /)).not.toBeInTheDocument()
    expect(
      [...document.querySelectorAll('div')].filter((d) => d.style.bottom.endsWith('%')),
    ).toHaveLength(0)
  })
})

/* --- the verdict-ownership guards -----------------------------------------
 *
 * CLAUDE.md: the UI renders verdicts and cutoffs from the payload; it never
 * computes, re-derives or hardcodes them. The recorded fixture's reject
 * threshold happens to equal the policy constant, so a component with that
 * constant baked in would pass every test that uses it. These use SYNTHETIC
 * values that no policy has, so only reading the payload can pass.
 */

const SYNTHETIC_THRESHOLDS = {
  eccentricity_reject: 0.9,
  eccentricity_marginal: 0.7,
  fwhm_reject: 9.1,
  fwhm_marginal: 8.2,
  snr_floor: 3.3,
  star_count_floor: 7,
  scattered_light_reject: 0.5,
  scattered_light_marginal: 0.4,
}

const withSummary = (over: Record<string, unknown>) => {
  const r = structuredClone(realReport)
  r.summary = { ...r.summary, ...over }
  return r
}

describe('cutoff lines come from the payload, never from a constant', () => {
  it('draws and labels whatever cutoffs the report carries', async () => {
    stubRoutes((url) =>
      url.includes('qa_analysis_status')
        ? json(completeM81(withSummary({ thresholds: SYNTHETIC_THRESHOLDS })))
        : undefined,
    )
    render_()

    fireEvent.click(await screen.findByRole('button', { name: /^M 81/ }))

    expect(await screen.findByText('reject 0.9')).toBeInTheDocument()
    expect(screen.getByText('marginal 0.7')).toBeInTheDocument()
    expect(screen.getByText('floor 7')).toBeInTheDocument()
    // Eccentricity's two lines plus star count's floor.
    expect(
      [...document.querySelectorAll('div')].filter((d) => d.style.bottom.endsWith('%')),
    ).toHaveLength(3)
  })
})

describe('the UI never re-derives a verdict from the numbers', () => {
  // A sub the server PASSED whose eccentricity is above this report's own
  // reject cutoff. Contradictory on purpose: if any component compared the
  // value to the threshold it would turn red, and nothing else would catch
  // that.
  const contrarian = {
    ...realReport.summary.subs[20],
    name: 'Light_contrarian_0001',
    verdict: 'PASS',
    reasons: [serverReason.pass],
    metrics: { ...realReport.summary.subs[20].metrics, eccentricity: 0.95 },
  }
  const report = () => {
    const r = withSummary({ thresholds: SYNTHETIC_THRESHOLDS })
    r.summary.subs = [contrarian, ...r.summary.subs.slice(1)]
    return r
  }
  const eccBar = () =>
    screen
      .getAllByRole('img')
      .find((b) => (b.getAttribute('aria-label') ?? '').startsWith('sub 0 ·'))!

  it('desktop: PASS badge, no reject tone, no blamed cell', async () => {
    stubRoutes((url) =>
      url.includes('qa_analysis_status') ? json(completeM81(report())) : undefined,
    )
    render_()
    fireEvent.click(await screen.findByRole('button', { name: /^M 81/ }))
    await screen.findByText('reject 0.9')

    const row = screen.getByTitle(contrarian.name).parentElement!
    expect(within(row).getByText('PASS')).toBeInTheDocument()
    const cells = [...row.children].slice(1, 6)
    expect(cells[1]).toHaveTextContent('0.95')
    for (const cell of cells) expect(cell.className).not.toMatch(/reject|marginal/)
    expect(eccBar().className).not.toMatch(/reject|marginal/)
  })

  it('mobile: PASS badge and no reject tone on its bar', async () => {
    stubRoutes((url) =>
      url.includes('qa_analysis_status') ? json(completeM81(report())) : undefined,
    )
    renderMobile()
    await pickMobile('M81')
    await screen.findByText('reject 0.9')

    const card = screen.getByTitle(contrarian.name).parentElement!.parentElement!
    expect(within(card).getByText('PASS')).toBeInTheDocument()
    expect(within(card).getByText(/ECC 0.95/)).toBeInTheDocument()
    expect(eccBar().className).not.toMatch(/reject|marginal/)
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

/* --- state handling -------------------------------------------------------
 *
 * These drive the screen through a fetch stub that can hold a response open,
 * so a test can act while a request is in flight — the timing the bugs below
 * lived in.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status })

type Route = (url: string) => Promise<Response> | Response | undefined

/** `route` answers first; anything it declines falls through to the same
 * defaults `stubFetch` uses. */
function stubRoutes(route: Route) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      const answered = await route(url)
      if (answered) return answered
      if (url.includes('/api/qa_targets')) return json(TARGETS)
      if (url.includes('/api/qa_analysis_status')) {
        return json({ ok: true, target_id: 'M81', sub_count: 587, status: 'not_analysed' })
      }
      return json({ ok: true })
    }),
  )
}

/** A promise the test resolves by hand. */
function held<T>() {
  let release!: (value: T) => void
  const promise = new Promise<T>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

const staleM81 = (report: unknown = realReport) => ({
  ok: true,
  target_id: 'M81',
  sub_count: 25,
  status: 'stale',
  analysed_at: '2026-08-01T22:00:00+00:00',
  report,
})

const completeM81 = (report: unknown = realReport) => ({
  ok: true,
  target_id: 'M81',
  sub_count: 25,
  status: 'complete',
  analysed_at: '2026-08-02T01:15:00+00:00',
  report,
})

/** What the sidecar sends when it will not start another job (HTTP 429). */
const REFUSAL = {
  ok: false,
  error: 'analysis capacity reached — a job is already running; try again when it finishes',
}

const renderMobile = () => {
  stubMatchMedia(true)
  return render_()
}

const pickMobile = async (targetId: string) => {
  fireEvent.change(await screen.findByRole('combobox'), { target: { value: targetId } })
}

describe('Analyse is never stranded on "Starting…"', () => {
  it('a start in flight for one target does not disable Analyse on the next', async () => {
    const start = held<Response>()
    stubRoutes((url) => {
      if (url.includes('qa_analysis_start')) return start.promise
      if (url.includes('qa_analysis_status') && url.includes('M42')) {
        return json({ ok: true, target_id: 'M42', sub_count: 1204, status: 'not_analysed' })
      }
      return undefined
    })
    render_()

    fireEvent.click(await screen.findByRole('button', { name: /^M 81/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Analyse 587 subs/ }))
    expect(await screen.findByRole('button', { name: /Starting/ })).toBeDisabled()

    // Move on while M81's POST is still out.
    fireEvent.click(screen.getByRole('button', { name: /^M 42/ }))
    expect(await screen.findByRole('button', { name: /Analyse 1204 subs/ })).toBeEnabled()

    // M81's answer arriving late must not re-disable anything.
    start.release(
      json({
        ok: true,
        target_id: 'M81',
        sub_count: 587,
        status: 'running',
        started_at: null,
        elapsed_seconds: 0,
      }),
    )
    await waitFor(() => expect(calls.filter((u) => u.includes('M42')).length).toBeGreaterThan(0))
    expect(screen.getByRole('button', { name: /Analyse 1204 subs/ })).toBeEnabled()
  })
})

describe('a start answered from the cache', () => {
  it('renders the report the start response carries', async () => {
    stubRoutes((url) => {
      if (url.includes('qa_analysis_start')) return json(completeM81())
      return undefined
    })
    render_()

    fireEvent.click(await screen.findByRole('button', { name: /^M 81/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Analyse 587 subs/ }))

    expect(await screen.findByText(/of 25 subs · 76.0%/)).toBeInTheDocument()
  })

  it('fetches the report when the response has none, rather than going blank', async () => {
    // complete WITHOUT `report`: desktop had no branch for it and rendered
    // nothing at all.
    let statusCalls = 0
    stubRoutes((url) => {
      if (url.includes('qa_analysis_start')) {
        const { report: _omit, ...bare } = completeM81()
        return json(bare)
      }
      if (url.includes('qa_analysis_status')) {
        statusCalls += 1
        return statusCalls === 1
          ? json({ ok: true, target_id: 'M81', sub_count: 587, status: 'not_analysed' })
          : json(completeM81())
      }
      return undefined
    })
    render_()

    fireEvent.click(await screen.findByRole('button', { name: /^M 81/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Analyse 587 subs/ }))

    expect(await screen.findByText(/of 25 subs · 76.0%/)).toBeInTheDocument()
    expect(statusCalls).toBe(2)
  })

  it('on mobile too, instead of "No analysis yet" and an Analyse button that loops', async () => {
    let statusCalls = 0
    stubRoutes((url) => {
      if (url.includes('qa_analysis_start')) {
        const { report: _omit, ...bare } = staleM81()
        return json(bare)
      }
      if (url.includes('qa_analysis_status')) {
        statusCalls += 1
        return statusCalls === 1
          ? json({ ok: true, target_id: 'M81', sub_count: 587, status: 'not_analysed' })
          : json(staleM81())
      }
      return undefined
    })
    renderMobile()

    await pickMobile('M81')
    fireEvent.click(await screen.findByRole('button', { name: /Analyse 587 subs/ }))

    expect(await screen.findByText('STALE')).toBeInTheDocument()
    expect(screen.queryByText(/No analysis yet/)).not.toBeInTheDocument()
  })
})

describe('a start the sidecar refuses (HTTP 429)', () => {
  const refuse = () =>
    stubRoutes((url) => {
      if (url.includes('qa_analysis_start')) return json(REFUSAL, 429)
      if (url.includes('qa_analysis_status')) return json(staleM81())
      return undefined
    })

  it('keeps the stale report and its row, and says why', async () => {
    refuse()
    render_()

    fireEvent.click(await screen.findByRole('button', { name: /^M 81/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Re-analyse 587 subs/ }))

    expect(await screen.findByText(REFUSAL.error)).toBeInTheDocument()
    expect(screen.getByText('STALE')).toBeInTheDocument()
    expect(screen.getByText(/of 25 subs · 76.0%/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^M 81/ })).toHaveTextContent('stale')
    expect(screen.getByRole('button', { name: /Re-analyse 587 subs/ })).toBeEnabled()
  })

  it('says why on mobile as well', async () => {
    refuse()
    renderMobile()

    await pickMobile('M81')
    fireEvent.click(await screen.findByRole('button', { name: /Re-analyse 587 subs/ }))

    expect(await screen.findByText(REFUSAL.error)).toBeInTheDocument()
    expect(screen.getByText('STALE')).toBeInTheDocument()
  })

  // After a failed job the button reads "Try again". Refused, it used to
  // flash "Starting…" and change nothing else: the failed branch never
  // rendered `error`, and errorNoteText returns null for a failed status, so
  // "job crashed" stayed on screen as if the retry had not happened.
  const refuseAfterFailure = () =>
    stubRoutes((url) => {
      if (url.includes('qa_analysis_start')) return json(REFUSAL, 429)
      if (url.includes('qa_analysis_status')) {
        return json({ ok: true, target_id: 'M81', sub_count: 587, status: 'failed', error: 'job crashed' })
      }
      return undefined
    })

  it('says why when "Try again" after a failed job is refused', async () => {
    refuseAfterFailure()
    render_()

    fireEvent.click(await screen.findByRole('button', { name: /^M 81/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByText(new RegExp(REFUSAL.error))).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(REFUSAL.error)
    // The job's own failure is still what the status says, and still shown.
    expect(screen.getByText(/job crashed/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
  })

  it('says why on mobile when "Try again" is refused', async () => {
    refuseAfterFailure()
    renderMobile()

    await pickMobile('M81')
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByText(new RegExp(REFUSAL.error))).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent(REFUSAL.error)
  })
})

describe('mobile keeps step with desktop', () => {
  it('shows a loading state while the status is being read, not "No analysis yet"', async () => {
    const status = held<Response>()
    stubRoutes((url) => (url.includes('qa_analysis_status') ? status.promise : undefined))
    renderMobile()

    await pickMobile('M81')

    expect(await screen.findByText(/Reading this target/)).toBeInTheDocument()
    expect(screen.queryByText(/No analysis yet/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Analyse/ })).not.toBeInTheDocument()
    status.release(json({ ok: true, target_id: 'M81', sub_count: 587, status: 'not_analysed' }))
    expect(await screen.findByText(/No analysis yet/)).toBeInTheDocument()
  })

  it('says the status read failed, and offers to try again — not "Analyse"', async () => {
    stubRoutes((url) =>
      url.includes('qa_analysis_status') ? json({ ok: false, error: 'status route down' }, 500) : undefined,
    )
    renderMobile()

    await pickMobile('M81')

    expect(await screen.findByText(/status route down/)).toBeInTheDocument()
    expect(screen.queryByText(/No analysis yet/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Analyse/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument()
  })

  it('marks a stale report as stale, with its date and a way to re-analyse', async () => {
    stubRoutes((url) => (url.includes('qa_analysis_status') ? json(staleM81()) : undefined))
    renderMobile()

    await pickMobile('M81')

    expect(await screen.findByText('STALE')).toBeInTheDocument()
    expect(screen.getByText(/2026-08-01 22:00/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Re-analyse 587 subs/ })).toBeInTheDocument()
  })

  it('desktop shows the same loading state', async () => {
    const status = held<Response>()
    stubRoutes((url) => (url.includes('qa_analysis_status') ? status.promise : undefined))
    render_()

    fireEvent.click(await screen.findByRole('button', { name: /^M 81/ }))

    expect(await screen.findByText(/Reading this target/)).toBeInTheDocument()
    status.release(json({ ok: true, target_id: 'M81', sub_count: 587, status: 'not_analysed' }))
  })
})

describe('the detail card follows the current report', () => {
  it('shows the re-analysed verdict, not the one it was opened on', async () => {
    const first = realReport.summary.subs[0]
    const reanalysed = structuredClone(realReport)
    reanalysed.summary.subs[0] = { ...first, verdict: 'PASS', reasons: [serverReason.pass] }
    stubRoutes((url) => {
      if (url.includes('qa_analysis_start')) return json(completeM81(reanalysed))
      if (url.includes('qa_analysis_status')) return json(staleM81())
      return undefined
    })
    render_()

    fireEvent.click(await screen.findByRole('button', { name: /^M 81/ }))
    await screen.findByText(/of 25 subs/)
    fireEvent.click(screen.getByTitle(first.name))
    const card = await screen.findByTestId('sub-image-card')
    expect(card).toHaveTextContent('REJECT')

    fireEvent.click(screen.getByRole('button', { name: /Re-analyse 587 subs/ }))

    await waitFor(() => expect(screen.queryByText('STALE')).not.toBeInTheDocument())
    const after = screen.getByTestId('sub-image-card')
    expect(after).toHaveTextContent('PASS')
    expect(after).not.toHaveTextContent('REJECT')
  })
})

describe('an empty table says why it is empty', () => {
  it('distinguishes "every row filtered out" from an empty report', async () => {
    stubFetch(completeReport())
    render_()
    fireEvent.click(await screen.findByRole('button', { name: /^M 81/ }))
    await screen.findByText(/of 25 subs/)

    for (const label of ['REJECT', 'MARGINAL', 'PASS']) {
      fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label}`) }))
    }

    expect(screen.getByText(/no subs match these filters/)).toBeInTheDocument()
    expect(screen.queryByText(/no subs in this report/)).not.toBeInTheDocument()
  })
})

describe('the Projects → Review handoff', () => {
  beforeEach(() => window.sessionStorage.clear())

  it('opens the handed-over target under StrictMode, as main.tsx renders it in dev', async () => {
    // StrictMode runs the mount effect, cleans it up and runs it again. The
    // first run took the target out of storage and was then cancelled; the
    // second found nothing, so in dev the handoff selected nothing.
    setPendingReviewTarget('M81')
    stubFetch()
    render(
      <StrictMode>
        <ReviewScreen view="review" onNavigate={vi.fn()} site={site} health={notReplaying} />
      </StrictMode>,
    )

    await waitFor(() =>
      expect(calls.some((u) => u.includes('qa_analysis_status') && u.includes('M81'))).toBe(true),
    )
    // Still consumed: a later, ordinary visit does not reopen it.
    expect(window.sessionStorage.getItem('seestar.review.pendingTarget')).toBeNull()
  })

  it('is consumed even when the listing fails, so it cannot reopen a target later', async () => {
    setPendingReviewTarget('M81')
    stubRoutes((url) =>
      url.includes('/api/qa_targets') ? json({ ok: false, error: 'archive offline' }, 500) : undefined,
    )
    const first = render_()
    expect(await screen.findByText(/Could not read the archive listing/)).toBeInTheDocument()
    first.unmount()

    calls = []
    stubFetch()
    render_()
    await screen.findByText(/Targets/)

    // A later, ordinary visit must open on the empty state.
    expect(calls.some((u) => u.includes('qa_analysis_status'))).toBe(false)
  })
})
