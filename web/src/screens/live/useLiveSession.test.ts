import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  lastStackFound,
  livePreviewStacked,
  recordedFocuserPosition,
  recordedGuardrails,
  recordedObservability,
  recordedParkedViewState,
  recordedStatus,
  recordedTier1,
  recordedViewState,
  runStateActive,
  runStateIdle,
  sessionActivity,
} from '../../test/fixtures'
import { REQUEST_TIMEOUT_MS } from '../../api/client'
import { ViewStateSchema } from '../../api/schemas'
import {
  FAILED_POLLS_LIMIT,
  IDLE_DEVICE_CHECK_EVERY,
  isObserving,
  POLL_INTERVAL_MS,
  SESSION_GAP_MS,
  useLiveSession,
} from './useLiveSession'

/**
 * useLiveSession across several polls. LiveScreen.test.tsx covers what one
 * poll renders; these drive the clock through many, because every defect
 * here only shows on the second poll or later: state carried from a
 * previous session, a back-off that outlives the reason for it, a poll that
 * overlaps the one before it.
 *
 * Fake timers, so no `waitFor` (it polls on the real clock). `tick()`
 * advances the fake clock inside `act`; vitest's async advance yields a real
 * macrotask between timers, which drains the mocked fetch chains.
 */

type Reply = { status: number; body: unknown } | 'hang'
type Route = Reply | ((url: string) => Reply)

const ok = (body: unknown): Reply => ({ status: 200, body })
const fail = (error: string, status = 502): Reply => ({ status, body: { ok: false, error } })

/** Per-path fetch stub over a MUTABLE route table, so a test can change what
 * the "scope" says between polls. Unrouted paths 404, which is also how an
 * older server without `/api/get_run_state` looks. */
function stubRoutes(routes: Record<string, Route>) {
  const mock = vi.fn((url: string, _init?: RequestInit) => {
    const path = url.split('?')[0]
    const route = routes[path]
    const reply = route === undefined ? fail(`no stub for ${url}`, 404) : typeof route === 'function' ? route(url) : route
    if (reply === 'hang') return new Promise<never>(() => {})
    return Promise.resolve({ ok: reply.status < 400, status: reply.status, json: async () => reply.body })
  })
  vi.stubGlobal('fetch', mock)
  return {
    routes,
    fetch: mock,
    urls: (fragment: string) => mock.mock.calls.map(([u]) => u).filter((u) => u.includes(fragment)),
  }
}

/** A session in progress, from the recorded fixtures. No run_state route:
 * the fail-open path, as against an older server or a hand-driven session. */
const activeRoutes = (): Record<string, Route> => ({
  '/api/get_view_state': ok(recordedViewState()),
  '/api/get_status': ok(recordedStatus()),
  '/api/check_night_guardrails': ok(recordedGuardrails()),
  '/api/qa_tier1': ok(recordedTier1()),
  '/api/get_focuser_position': ok(recordedFocuserPosition()),
  '/api/get_target_observability': ok(recordedObservability()),
  '/api/live_preview': ok(livePreviewStacked()),
  '/api/session_activity': ok(sessionActivity()),
  '/api/last_stack': ok(lastStackFound()),
})

/** Scope connected, no view session: `result: {}` (hardware, 2026-07-31).
 * Only a freshly booted scope answers this way; a parked one keeps its ended
 * View (see `recordedParkedViewState`). */
const noView = () => ({ ok: true, view_state: { method: 'get_view_state', result: {}, code: 0 } })

type Mutable = { observing?: unknown; view_state: { result: { View: Record<string, unknown> } } }

/** The July working recording with some View fields and top-level fields
 * changed. */
const workingWith = (view: Record<string, unknown>, top: Record<string, unknown> = {}) => {
  const payload = recordedViewState() as Mutable
  Object.assign(payload.view_state.result.View, view)
  return { ...payload, ...top }
}

const sessionStartOf = (url: string): string =>
  new URL(url, 'http://x').searchParams.get('session_start_utc') ?? ''

const tick = (ms = 0) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('polls never overlap, and stop cleanly', () => {
  // setInterval fired whether or not the previous poll had finished. The
  // sidecar serialises MCP calls, so slow polls stacked up behind each other
  // and interleaved their writes to the same refs.
  it('does not start the next poll while the current one is still waiting', async () => {
    const api = stubRoutes({ ...activeRoutes(), '/api/get_view_state': 'hang' })
    renderHook(() => useLiveSession())
    await tick()
    await tick(POLL_INTERVAL_MS)

    expect(api.urls('get_view_state')).toHaveLength(1)
  })

  it('schedules the next poll one interval after the previous one settled', async () => {
    // The hung request is abandoned at REQUEST_TIMEOUT_MS; that poll then
    // settles (bridge up, so idle) and the next one follows a full interval
    // later.
    const api = stubRoutes({ ...activeRoutes(), '/api/get_view_state': 'hang' })
    const { result } = renderHook(() => useLiveSession())
    await tick()
    await tick(REQUEST_TIMEOUT_MS)
    expect(result.current.phase).toBe('idle')

    api.routes['/api/get_view_state'] = ok(recordedViewState())
    await tick(POLL_INTERVAL_MS - 1)
    expect(api.urls('get_view_state')).toHaveLength(1)
    await tick(1)
    expect(api.urls('get_view_state')).toHaveLength(2)
    expect(result.current.phase).toBe('active')
  })

  it('aborts its in-flight requests when the screen unmounts', async () => {
    const api = stubRoutes({ ...activeRoutes(), '/api/get_view_state': 'hang' })
    const { unmount } = renderHook(() => useLiveSession())
    await tick()
    const signal = api.fetch.mock.calls.find(([u]) => u.includes('get_view_state'))?.[1]?.signal
    expect(signal?.aborted).toBe(false)

    unmount()

    expect(signal?.aborted).toBe(true)
  })

  it('requests nothing more after unmount', async () => {
    const api = stubRoutes(activeRoutes())
    const { unmount } = renderHook(() => useLiveSession())
    await tick()
    unmount()
    const before = api.fetch.mock.calls.length
    await tick(POLL_INTERVAL_MS * 3)

    expect(api.fetch.mock.calls.length).toBe(before)
  })
})

describe('the idle back-off and a session driven by hand', () => {
  // run_state.json is written only by skill-driven runs, so a session
  // started from the phone app reads `idle` on every poll. The back-off
  // counted that answer, so polls 2-5 skipped the device check: stack count,
  // preview, guardrails and log froze for ~4 minutes, and the session's end
  // went unnoticed for up to 5.
  const handDriven = () => ({ ...activeRoutes(), '/api/get_run_state': ok(runStateIdle()) })

  it('checks the device on every poll while it reports a View', async () => {
    const api = stubRoutes(handDriven())
    const { result } = renderHook(() => useLiveSession())
    await tick()
    expect(result.current.phase).toBe('active')

    const moved = recordedViewState() as { view_state: { result: { View: { Stack: { stacked_frame: number } } } } }
    moved.view_state.result.View.Stack.stacked_frame = 131
    api.routes['/api/get_view_state'] = ok(moved)
    await tick(POLL_INTERVAL_MS)
    await tick(POLL_INTERVAL_MS)

    expect(api.urls('get_view_state')).toHaveLength(3)
    const state = result.current
    if (state.phase !== 'active') throw new Error('expected active')
    expect(state.viewState.view_state?.result?.View?.Stack?.stacked_frame).toBe(131)
  })

  it('notices on the very next poll when the hand-driven session ends', async () => {
    const api = stubRoutes(handDriven())
    const { result } = renderHook(() => useLiveSession())
    await tick()
    expect(result.current.phase).toBe('active')

    api.routes['/api/get_view_state'] = ok(noView())
    await tick(POLL_INTERVAL_MS)

    expect(result.current.phase).toBe('idle')
  })

  it('still backs off once the scope itself says it is idle', async () => {
    // The saving the back-off exists for must survive the fix: a parked
    // scope is asked once, then left alone for IDLE_DEVICE_CHECK_EVERY polls.
    const api = stubRoutes({ ...handDriven(), '/api/get_view_state': ok(noView()) })
    renderHook(() => useLiveSession())
    await tick()
    for (let i = 0; i < 4; i += 1) await tick(POLL_INTERVAL_MS)

    expect(api.urls('get_view_state')).toHaveLength(1)
  })
})

describe('the last completed stack is fetched until it actually answers', () => {
  // Fetched per target, not per poll (a ~730 KB JPEG). The target used to be
  // recorded BEFORE the fetch, so one transient failure was never retried
  // for that target: the panel stayed on "unreachable" all night.
  const absent = (reason: string) => ok({ ok: true, target: null, captured_at: null, frame_count: null, url: '/api/last_stack/image', reason })

  it.each([
    ['the share was unreachable', absent('share_unreachable')],
    ['the bridge was down', absent('bridge_down')],
    ['the sidecar saw the scope idle (a race with our own check)', absent('idle')],
    ['the request itself failed', fail('sidecar hiccup')],
  ])('retries on the next poll when %s', async (_label, firstReply) => {
    const api = stubRoutes({ ...activeRoutes(), '/api/last_stack': firstReply })
    const { result } = renderHook(() => useLiveSession())
    await tick()
    expect(api.urls('last_stack')).toHaveLength(1)

    api.routes['/api/last_stack'] = ok(lastStackFound())
    await tick(POLL_INTERVAL_MS)

    expect(api.urls('last_stack')).toHaveLength(2)
    const state = result.current
    if (state.phase !== 'active') throw new Error('expected active')
    expect(state.lastStack?.frame_count).toBe(178)
  })

  it.each([
    ['a stack was found', ok(lastStackFound())],
    ['there is no completed stack for this target yet', absent('no_stack')],
  ])('does not ask again for the same target once %s', async (_label, reply) => {
    const api = stubRoutes({ ...activeRoutes(), '/api/last_stack': reply })
    renderHook(() => useLiveSession())
    await tick()
    await tick(POLL_INTERVAL_MS)
    await tick(POLL_INTERVAL_MS)

    expect(api.urls('last_stack')).toHaveLength(1)
  })
})

describe('per-session state does not outlive the session', () => {
  it.each([
    ['get_view_state reports no View', () => ok(noView()), 'idle'],
    // Not idle any more: one failed read is not evidence the session ended
    // (see 'one bad poll does not end a session' below). What ends it here
    // is the day that passes before the next View.
    ['get_view_state times out while get_status answers', () => fail('get_view_state timed out'), 'active'],
  ])('starts the next night from scratch when the scope went idle in between (%s)', async (_label, idleReply, between) => {
    // A tab left open overnight. sessionStartedAtRef used to be written once
    // and never cleared, so the next night's guardrail check measured
    // elapsed time from yesterday: a false `park_and_stop — Session duration
    // 24.3h` at the start of a perfectly good night.
    vi.setSystemTime(new Date('2026-08-02T21:00:00Z'))
    const api = stubRoutes(activeRoutes())
    const { result } = renderHook(() => useLiveSession())
    await tick()
    expect(result.current.phase).toBe('active')
    const firstStart = sessionStartOf(api.urls('check_night_guardrails')[0])
    expect(firstStart).toBe('2026-08-02T21:00:00.000Z')

    api.routes['/api/get_view_state'] = idleReply()
    await tick(POLL_INTERVAL_MS)
    expect(result.current.phase).toBe(between)

    vi.setSystemTime(new Date('2026-08-03T21:00:00Z'))
    api.routes['/api/get_view_state'] = ok(recordedViewState())
    await tick(POLL_INTERVAL_MS)
    expect(result.current.phase).toBe('active')

    const starts = api.urls('check_night_guardrails').map(sessionStartOf)
    const tonight = starts[starts.length - 1]
    expect(Date.parse(tonight)).toBeGreaterThanOrEqual(Date.parse('2026-08-03T21:00:00Z'))

    // The rest of the session's memory goes with it: one night's log and
    // stage breadcrumb, not two nights run together.
    const state = result.current
    if (state.phase !== 'active') throw new Error('expected active')
    expect(state.log).toHaveLength(1)
    expect(state.stageHistory).toEqual(['Stack'])
  })

  it('forgets the previous session\'s target once the scope has been idle', async () => {
    // currentTarget is sticky within a session on purpose (a poll where both
    // sources blink must not blank the header). Across sessions that
    // stickiness names last night's object over tonight's.
    const api = stubRoutes(activeRoutes())
    const { result } = renderHook(() => useLiveSession())
    await tick()
    const state = result.current
    if (state.phase !== 'active') throw new Error('expected active')
    expect(state.currentTarget).toBe('NGC7380')

    // Idle twice running: the confirmed end (one no-View answer alone is
    // not — see 'an idle answer ends the session only once confirmed').
    api.routes['/api/get_view_state'] = ok(noView())
    await tick(POLL_INTERVAL_MS)
    await tick(POLL_INTERVAL_MS)

    // Tonight's session has not named its target yet: no target_name on the
    // View, and the preview has nothing either.
    const unnamed = recordedViewState() as { view_state: { result: { View: Record<string, unknown> } } }
    delete unnamed.view_state.result.View.target_name
    api.routes['/api/get_view_state'] = ok(unnamed)
    api.routes['/api/live_preview'] = ok({ ok: true, source: null, captured_at: null, stale: false, url: '/api/live_preview/image', reason: 'no_frame' })
    await tick(POLL_INTERVAL_MS)

    const next = result.current
    if (next.phase !== 'active') throw new Error('expected active')
    expect(next.currentTarget).toBeNull()
    expect(next.lastStack).toBeNull()
  })

  it('also starts from scratch after the bridge went down in between', async () => {
    vi.setSystemTime(new Date('2026-08-02T21:00:00Z'))
    const api = stubRoutes(activeRoutes())
    const { result } = renderHook(() => useLiveSession())
    await tick()

    api.routes['/api/get_view_state'] = fail('bridge unreachable')
    api.routes['/api/get_status'] = fail('bridge unreachable')
    await tick(POLL_INTERVAL_MS)
    // Held as a stale session, not ended: a bridge that drops for one poll
    // must not restart the guardrail clock.
    expect(result.current.phase).toBe('active')

    vi.setSystemTime(new Date('2026-08-03T21:00:00Z'))
    api.routes['/api/get_view_state'] = ok(recordedViewState())
    await tick(POLL_INTERVAL_MS)

    const starts = api.urls('check_night_guardrails').map(sessionStartOf)
    expect(Date.parse(starts[starts.length - 1])).toBeGreaterThanOrEqual(Date.parse('2026-08-03T21:00:00Z'))
  })

  it('ends a session nobody has seen for longer than SESSION_GAP_MS, however the polls in between failed', async () => {
    // The bridge is down all day (the scope switched off at dawn), and no
    // poll ever gets an explicit idle answer. The next View is the same
    // target on the next night: without a time limit it would inherit
    // yesterday's start.
    vi.setSystemTime(new Date('2026-08-02T21:00:00Z'))
    const api = stubRoutes(activeRoutes())
    const { result } = renderHook(() => useLiveSession())
    await tick()

    api.routes['/api/get_view_state'] = fail('bridge unreachable')
    api.routes['/api/get_status'] = fail('bridge unreachable')
    await tick(SESSION_GAP_MS + POLL_INTERVAL_MS)
    expect(result.current.phase).toBe('bridge-down')

    // Same target again: a new session, not yesterday's.
    api.routes['/api/get_view_state'] = ok(recordedViewState())
    api.routes['/api/get_status'] = ok(recordedStatus())
    await tick(POLL_INTERVAL_MS)
    const state = result.current
    if (state.phase !== 'active') throw new Error('expected active')
    expect(state.log).toHaveLength(1)
    const starts = api.urls('check_night_guardrails').map(sessionStartOf)
    expect(Date.parse(starts[starts.length - 1])).toBeGreaterThan(Date.parse('2026-08-02T21:00:00Z') + SESSION_GAP_MS)
  })
})

describe('a run of failed polls lets the session go', () => {
  // Holding every failed read as a stale session overcorrected. The
  // documented idle signature is get_view_state failing while get_status
  // answers, and park-then-sleep looks like bridge-down; both kept a finished
  // session on screen as "Not current" until SESSION_GAP_MS, with the idle
  // back-off bypassed the whole time.
  //
  // Each step is one poll's full answer: get_view_state and get_status.
  type Step = Record<string, Route>
  const statusOk = ok(recordedStatus())
  const VIEW: Step = { '/api/get_view_state': ok(recordedViewState()), '/api/get_status': statusOk }
  const NO_VIEW: Step = { '/api/get_view_state': ok(noView()), '/api/get_status': statusOk }
  const RELAYED: Step = { '/api/get_view_state': fail('get_view_state timed out'), '/api/get_status': statusOk }
  const BRIDGE_DOWN: Step = {
    '/api/get_view_state': fail('bridge unreachable'),
    '/api/get_status': fail('bridge unreachable'),
  }
  const UNREADABLE: Step = {
    '/api/get_view_state': ok({ ok: true, result: { View: { stage: 'Stack' } } }),
    '/api/get_status': statusOk,
  }
  const HANG: Step = { '/api/get_view_state': 'hang', '/api/get_status': statusOk }
  const T0 = Date.parse('2026-08-02T21:00:00Z')

  async function openSession(routes: Record<string, Route> = activeRoutes()) {
    vi.setSystemTime(new Date(T0))
    const api = stubRoutes(routes)
    const { result } = renderHook(() => useLiveSession())
    await tick()
    return { api, result }
  }

  /** One poll per step. A 'hang' step also waits out the client timeout, so
   * the next step starts exactly when the next poll does. */
  async function poll(api: ReturnType<typeof stubRoutes>, ...steps: Step[]) {
    for (const step of steps) {
      Object.assign(api.routes, step)
      await tick(POLL_INTERVAL_MS)
      if (step['/api/get_view_state'] === 'hang') await tick(REQUEST_TIMEOUT_MS)
    }
  }

  const repeat = (step: Step, n: number): Step[] => Array.from({ length: n }, () => step)

  it('ends the session after FAILED_POLLS_LIMIT relayed view failures in a row', async () => {
    const { api, result } = await openSession()

    await poll(api, ...repeat(RELAYED, FAILED_POLLS_LIMIT - 1))
    expect(result.current.phase).toBe('active') // held, as stale
    await poll(api, RELAYED)
    expect(result.current.phase).toBe('idle')

    await poll(api, VIEW)
    const state = result.current
    if (state.phase !== 'active') throw new Error('expected active')
    expect(state.log).toHaveLength(1)
    const starts = api.urls('check_night_guardrails').map(sessionStartOf)
    expect(Date.parse(starts[starts.length - 1])).toBe(T0 + (FAILED_POLLS_LIMIT + 1) * POLL_INTERVAL_MS)
  })

  // The rule for a mixed run: consecutive idle-looking polls (explicit
  // no-View answers and relayed failures) count together, ending the session
  // at IDLE_ANSWERS_TO_END if every one was explicit and at
  // FAILED_POLLS_LIMIT once any was relayed. Other failures carry no answer
  // either way, so they neither count nor break the run.
  it.each<[string, boolean, Step[]]>([
    ['two explicit no-View answers', true, [NO_VIEW, NO_VIEW]],
    ['explicit answers either side of a bridge-down', true, [NO_VIEW, BRIDGE_DOWN, NO_VIEW]],
    ['a relayed failure then an explicit answer', false, [RELAYED, NO_VIEW]],
    ['an explicit answer then relayed failures, short of the limit', false, [NO_VIEW, ...repeat(RELAYED, FAILED_POLLS_LIMIT - 2)]],
    ['an explicit answer then relayed failures, to the limit', true, [NO_VIEW, ...repeat(RELAYED, FAILED_POLLS_LIMIT - 1)]],
    ['relayed failures then an explicit answer, to the limit', true, [...repeat(RELAYED, FAILED_POLLS_LIMIT - 1), NO_VIEW]],
  ])('%s: ends the session = %s', async (_label, ends, steps) => {
    const { api, result } = await openSession()

    await poll(api, ...steps, VIEW)

    const state = result.current
    if (state.phase !== 'active') throw new Error('expected active')
    const starts = api.urls('check_night_guardrails').map(sessionStartOf)
    const last = Date.parse(starts[starts.length - 1])
    if (ends) {
      expect(state.log).toHaveLength(1)
      expect(last).toBe(T0 + (steps.length + 1) * POLL_INTERVAL_MS)
    } else {
      expect(state.log).toHaveLength(2)
      expect(last).toBe(T0)
    }
  })

  it.each<[string, Step, string]>([
    ['the bridge is down', BRIDGE_DOWN, 'bridge-down'],
    ['get_view_state cannot be read', UNREADABLE, 'unrecognised'],
    ['get_view_state gets no answer from the sidecar', HANG, 'idle'],
  ])('after FAILED_POLLS_LIMIT failed polls where %s, shows that failure but keeps the session', async (_label, failure, phase) => {
    const { api, result } = await openSession()

    await poll(api, ...repeat(failure, FAILED_POLLS_LIMIT - 1))
    expect(result.current.phase).toBe('active')
    await poll(api, failure)
    expect(result.current.phase).toBe(phase)

    // The scope is back: the same session, with its true start.
    await poll(api, VIEW)
    const state = result.current
    if (state.phase !== 'active') throw new Error('expected active')
    expect(state.stale).toBeNull()
    expect(state.log).toHaveLength(2)
    const starts = api.urls('check_night_guardrails').map(sessionStartOf)
    expect(Date.parse(starts[starts.length - 1])).toBe(T0)
  })

  it('backs off again once FAILED_POLLS_LIMIT polls in a row have failed', async () => {
    // A hand-driven session (run_state idle), so the back-off applies as
    // soon as the device check stops being forced.
    const { api } = await openSession({ ...activeRoutes(), '/api/get_run_state': ok(runStateIdle()) })

    // Held: the device is asked on every one of these polls.
    await poll(api, ...repeat(UNREADABLE, FAILED_POLLS_LIMIT))
    const held = api.urls('get_view_state').length
    expect(held).toBe(1 + FAILED_POLLS_LIMIT)

    // Released: one device check per IDLE_DEVICE_CHECK_EVERY polls.
    await poll(api, ...repeat(UNREADABLE, IDLE_DEVICE_CHECK_EVERY))
    expect(api.urls('get_view_state').length - held).toBe(1)
  })
})

describe('one bad poll does not end a session', () => {
  // endSession() used to run on the FIRST poll that saw no View, and on
  // bridge-down. One transient get_view_state failure reset the session
  // start and wiped the telemetry log, stage history and last stack. In a
  // hand-driven session (run_state idle, so no real start from the server)
  // that restarted check_night_guardrails' elapsed clock from "now" — the
  // direction that understates elapsed time on a guardrail that governs a
  // hard stop.
  const handDriven = () => ({ ...activeRoutes(), '/api/get_run_state': ok(runStateIdle()) })

  it.each<[string, Record<string, Route>]>([
    ['get_view_state fails while get_status answers', { '/api/get_view_state': fail('get_view_state timed out') }],
    ['get_view_state gets no answer before the client timeout', { '/api/get_view_state': 'hang' }],
    ['get_view_state answers in a shape this client cannot read', { '/api/get_view_state': ok({ ok: true, result: { View: { stage: 'Stack' } } }) }],
    ['the bridge is down', { '/api/get_view_state': fail('bridge unreachable'), '/api/get_status': fail('bridge unreachable') }],
  ])('keeps the session, shown as stale, when %s', async (_label, failure) => {
    vi.setSystemTime(new Date('2026-08-02T21:00:00Z'))
    const api = stubRoutes(handDriven())
    const { result } = renderHook(() => useLiveSession())
    await tick()
    const start = sessionStartOf(api.urls('check_night_guardrails')[0])
    expect(start).toBe('2026-08-02T21:00:00.000Z')

    const good = { ...api.routes }
    Object.assign(api.routes, failure)
    await tick(POLL_INTERVAL_MS)
    await tick(REQUEST_TIMEOUT_MS) // settles the 'hang' case; a no-op for the rest

    const stale = result.current
    if (stale.phase !== 'active') throw new Error(`expected the session held as stale, got ${stale.phase}`)
    expect(stale.stale).toBeTruthy()
    expect(stale.log).toHaveLength(1)
    expect(stale.stageHistory).toEqual(['Stack'])
    expect(stale.lastStack).not.toBeNull()

    Object.assign(api.routes, good)
    await tick(POLL_INTERVAL_MS)

    const back = result.current
    if (back.phase !== 'active') throw new Error('expected active')
    expect(back.stale).toBeNull()
    // Still the same session: the log carries on, and the guardrail is asked
    // with the original start, not the moment the failure cleared.
    expect(back.log).toHaveLength(2)
    const starts = api.urls('check_night_guardrails').map(sessionStartOf)
    expect(starts[starts.length - 1]).toBe(start)
  })
})

describe('an idle answer ends the session only once confirmed', () => {
  it('keeps the session through a single poll reporting no View', async () => {
    vi.setSystemTime(new Date('2026-08-02T21:00:00Z'))
    const api = stubRoutes(activeRoutes())
    const { result } = renderHook(() => useLiveSession())
    await tick()

    api.routes['/api/get_view_state'] = ok(noView())
    await tick(POLL_INTERVAL_MS)
    // Shown as idle — that is what the scope said — but not forgotten.
    expect(result.current.phase).toBe('idle')

    api.routes['/api/get_view_state'] = ok(recordedViewState())
    await tick(POLL_INTERVAL_MS)

    const state = result.current
    if (state.phase !== 'active') throw new Error('expected active')
    expect(state.log).toHaveLength(2)
    const starts = api.urls('check_night_guardrails').map(sessionStartOf)
    expect(starts[starts.length - 1]).toBe('2026-08-02T21:00:00.000Z')
  })

  it('ends it on the second consecutive poll reporting no View', async () => {
    vi.setSystemTime(new Date('2026-08-02T21:00:00Z'))
    const api = stubRoutes(activeRoutes())
    const { result } = renderHook(() => useLiveSession())
    await tick()

    api.routes['/api/get_view_state'] = ok(noView())
    await tick(POLL_INTERVAL_MS)
    await tick(POLL_INTERVAL_MS)

    api.routes['/api/get_view_state'] = ok(recordedViewState())
    await tick(POLL_INTERVAL_MS)

    const state = result.current
    if (state.phase !== 'active') throw new Error('expected active')
    expect(state.log).toHaveLength(1)
    expect(state.stageHistory).toEqual(['Stack'])
    const starts = api.urls('check_night_guardrails').map(sessionStartOf)
    expect(Date.parse(starts[starts.length - 1])).toBe(Date.parse('2026-08-02T21:00:00Z') + 3 * POLL_INTERVAL_MS)
  })

  it('confirms a hand-driven session\'s end on the next poll, not after the idle back-off', async () => {
    // While a session is open the device is checked every poll, so the
    // second idle answer comes one poll later, not IDLE_DEVICE_CHECK_EVERY.
    const api = stubRoutes({ ...activeRoutes(), '/api/get_run_state': ok(runStateIdle()) })
    renderHook(() => useLiveSession())
    await tick()

    api.routes['/api/get_view_state'] = ok(noView())
    await tick(POLL_INTERVAL_MS)
    await tick(POLL_INTERVAL_MS)
    expect(api.urls('get_view_state')).toHaveLength(3)

    // Ended now, so the back-off applies again.
    await tick(POLL_INTERVAL_MS)
    expect(api.urls('get_view_state')).toHaveLength(3)
  })

  it('ends it on the first poll with no View once a skill-driven run has gone idle', async () => {
    const REAL_START = '2026-08-02T19:04:11.500000+00:00'
    const run = (state: string) => {
      const base = runStateActive() as { run: Record<string, unknown> }
      return ok({ ...base, state, run: { ...base.run, session_start_utc: REAL_START } })
    }
    vi.setSystemTime(new Date('2026-08-02T21:00:00Z'))
    const api = stubRoutes({ ...activeRoutes(), '/api/get_run_state': run('active') })
    const { result } = renderHook(() => useLiveSession())
    await tick()
    expect(sessionStartOf(api.urls('check_night_guardrails')[0])).toBe(REAL_START)

    api.routes['/api/get_run_state'] = run('idle')
    api.routes['/api/get_view_state'] = ok(noView())
    await tick(POLL_INTERVAL_MS)

    // A View again, the run still idle: a new, hand-driven session. The
    // ended session is behind the idle back-off again, so allow the polls
    // it takes to look.
    api.routes['/api/get_view_state'] = ok(recordedViewState())
    for (let i = 0; i < IDLE_DEVICE_CHECK_EVERY; i += 1) await tick(POLL_INTERVAL_MS)
    const state = result.current
    if (state.phase !== 'active') throw new Error('expected active')
    expect(state.log).toHaveLength(1)
    const starts = api.urls('check_night_guardrails').map(sessionStartOf)
    expect(starts).toHaveLength(2)
    expect(starts[1]).not.toBe(REAL_START)
    expect(Date.parse(starts[1])).toBeGreaterThan(Date.parse('2026-08-02T21:00:00Z') + POLL_INTERVAL_MS)
  })

  it("pins the sweet-band gauge to the session's own night, not whichever night 'now' falls in", async () => {
    // With no date, seestar-mcp (contract 1.2.0) answers for the night in
    // progress only inside astronomical dark, and the NEXT night after dawn —
    // so a session imaging into morning twilight would see its gauge flip to
    // tomorrow. An instant inside the session's night pins it. It is the same
    // start the guardrails are given.
    const REAL_START = '2026-09-26T20:05:00.000000+00:00'
    const base = runStateActive() as { run: Record<string, unknown> }
    vi.setSystemTime(new Date('2026-09-27T05:30:00Z'))
    const api = stubRoutes({
      ...activeRoutes(),
      '/api/get_run_state': ok({ ...base, state: 'active', run: { ...base.run, session_start_utc: REAL_START } }),
    })
    renderHook(() => useLiveSession())
    await tick()

    const dateOf = (url: string) => new URL(url, 'http://x').searchParams.get('date')
    expect(dateOf(api.urls('get_target_observability')[0])).toBe(REAL_START)
    expect(sessionStartOf(api.urls('check_night_guardrails')[0])).toBe(REAL_START)
  })

  it('pins a hand-driven session the same way, to the start the guardrails are given', async () => {
    vi.setSystemTime(new Date('2026-09-24T03:00:00Z'))
    const api = stubRoutes({ ...activeRoutes(), '/api/get_run_state': ok(runStateIdle()) })
    renderHook(() => useLiveSession())
    await tick()

    const date = new URL(api.urls('get_target_observability')[0], 'http://x').searchParams.get('date')
    expect(date).not.toBeNull()
    expect(date).toBe(sessionStartOf(api.urls('check_night_guardrails')[0]))
  })

  it('keeps the session clock through a goto to another target, resetting only what belongs to the target', async () => {
    // A hand-driven multi-target night: no run_state start to recover, so
    // ending the session on every goto restarted the guardrail's elapsed
    // clock from "now" at each one — understating elapsed time on a
    // guardrail that governs a hard stop.
    vi.setSystemTime(new Date('2026-08-02T21:00:00Z'))
    const api = stubRoutes({ ...activeRoutes(), '/api/get_run_state': ok(runStateIdle()) })
    const { result } = renderHook(() => useLiveSession())
    await tick()
    const first = result.current
    if (first.phase !== 'active') throw new Error('expected active')
    expect(first.currentTarget).toBe('NGC7380')

    const other = recordedViewState() as { view_state: { result: { View: Record<string, unknown> } } }
    other.view_state.result.View.target_name = 'M27'
    api.routes['/api/get_view_state'] = ok(other)
    await tick(POLL_INTERVAL_MS)

    const state = result.current
    if (state.phase !== 'active') throw new Error('expected active')
    // The session's clock carries on.
    const starts = api.urls('check_night_guardrails').map(sessionStartOf)
    expect(starts[starts.length - 1]).toBe('2026-08-02T21:00:00.000Z')
    // What belonged to the previous target does not.
    expect(state.currentTarget).toBe('M27')
    expect(state.stageHistory).toEqual(['Stack'])
    expect(state.log).toHaveLength(1)
    expect(api.urls('last_stack').filter((u) => u.includes('M27'))).toHaveLength(1)
  })
})

describe('a View is observing only while it is working (hardware, 2026-09-24)', () => {
  // A parked scope does not answer `result: {}`. It keeps the ended
  // session's View: state "cancel", mode "none", the last target and its
  // final counts. Any View used to count as observing, so the parked scope
  // showed as a live M1 session, and the guardrails fetch, given "now" as the
  // session start, reported `park_and_stop — Within 15 min of dawn`.
  const parse = (payload: unknown) => ViewStateSchema.parse(payload)

  describe('isObserving', () => {
    it.each<[string, boolean, unknown]>([
      ['the July working recording', true, recordedViewState()],
      ['the parked recording (cancel, mode none)', false, recordedParkedViewState()],
      ['a working View with mode "none"', false, workingWith({ mode: 'none' })],
      ['a View whose state is "complete"', false, workingWith({ state: 'complete' })],
      ['a View whose state is "fail" (not yet seen, assumed to exist)', false, workingWith({ state: 'fail' })],
      ['a View with no state at all', false, workingWith({ state: undefined })],
      ['no View (`result: {}`, a freshly booted scope)', false, noView()],
    ])('%s: observing = %s', (_label, expected, payload) => {
      expect(isObserving(parse(payload))).toBe(expected)
    })

    // seestar-mcp's get_view_state gains a top-level `observing` computed by
    // the same rule. The server's own answer wins over this client's reading
    // of the View whenever it is present.
    it('lets observing: false override a View that reads as working', () => {
      expect(isObserving(parse(workingWith({}, { observing: false })))).toBe(false)
    })

    it('honours observing: true over a View this client would not call working', () => {
      expect(isObserving(parse(workingWith({ mode: 'none' }, { observing: true })))).toBe(true)
    })

    it('falls back to the View when observing is null', () => {
      expect(isObserving(parse(workingWith({}, { observing: null })))).toBe(true)
      expect(isObserving(parse({ ...(recordedParkedViewState() as object), observing: null }))).toBe(false)
    })
  })

  it('treats the parked recording as idle: no guardrails, no preview, and the final counts kept for display', async () => {
    const api = stubRoutes({ ...activeRoutes(), '/api/get_view_state': ok(recordedParkedViewState()) })
    const { result } = renderHook(() => useLiveSession())
    await tick()

    const state = result.current
    if (state.phase !== 'idle') throw new Error(`expected idle, got ${state.phase}`)
    expect(state.viewError).toBeNull()
    expect(state.lastSession).toEqual({ target: 'M1', stacked: 1003, dropped: 0, ended: true })
    for (const route of ['check_night_guardrails', 'qa_tier1', 'get_focuser_position', 'live_preview', 'last_stack', 'get_status']) {
      expect(api.urls(route)).toEqual([])
    }
  })

  it('still treats the July working recording as an active session', async () => {
    const api = stubRoutes(activeRoutes())
    const { result } = renderHook(() => useLiveSession())
    await tick()

    expect(result.current.phase).toBe('active')
    expect(api.urls('check_night_guardrails')).toHaveLength(1)
  })

  it('reads the final counts from the server\'s stack summary when it sends one', async () => {
    // seestar-mcp's follow-up adds a top-level `stack` summary that persists
    // after a session ends. It is the server's own reading, so it wins.
    const parked = {
      ...(recordedParkedViewState() as object),
      observing: false,
      stack: { target_name: 'M1', stacked: 1004, dropped: 2, state: 'cancel', mode: 'none' },
    }
    stubRoutes({ ...activeRoutes(), '/api/get_view_state': ok(parked) })
    const { result } = renderHook(() => useLiveSession())
    await tick()

    const state = result.current
    if (state.phase !== 'idle') throw new Error(`expected idle, got ${state.phase}`)
    expect(state.lastSession).toEqual({ target: 'M1', stacked: 1004, dropped: 2, ended: true })
  })

  it('has no last session to show for a freshly booted scope', async () => {
    stubRoutes({ ...activeRoutes(), '/api/get_view_state': ok(noView()) })
    const { result } = renderHook(() => useLiveSession())
    await tick()

    const state = result.current
    if (state.phase !== 'idle') throw new Error(`expected idle, got ${state.phase}`)
    expect(state.lastSession).toBeNull()
  })

  it('goes idle on observing: false, and active on observing: true, whatever the View says', async () => {
    const api = stubRoutes({ ...activeRoutes(), '/api/get_view_state': ok(workingWith({}, { observing: false })) })
    const { result } = renderHook(() => useLiveSession())
    await tick()
    expect(result.current.phase).toBe('idle')
    expect(api.urls('check_night_guardrails')).toEqual([])

    api.routes['/api/get_view_state'] = ok(workingWith({ mode: 'none' }, { observing: true }))
    await tick(POLL_INTERVAL_MS)
    expect(result.current.phase).toBe('active')
  })

  it('shows a run, not idle, when get_run_state says a run is active and the View has ended', async () => {
    // The same withoutView rule as `result: {}`: a skill-driven run between
    // targets is not "Scope idle".
    stubRoutes({
      ...activeRoutes(),
      '/api/get_run_state': ok(runStateActive()),
      '/api/get_view_state': ok(recordedParkedViewState()),
    })
    const { result } = renderHook(() => useLiveSession())
    await tick()

    expect(result.current.phase).toBe('run-without-view')
  })

  it('keeps the idle back-off on a parked scope', async () => {
    // The parked View must not count as "the device says it is observing",
    // which resets the back-off: a parked scope is asked once, then left
    // alone until the IDLE_DEVICE_CHECK_EVERY-th poll after.
    const api = stubRoutes({
      ...activeRoutes(),
      '/api/get_run_state': ok(runStateIdle()),
      '/api/get_view_state': ok(recordedParkedViewState()),
    })
    renderHook(() => useLiveSession())
    await tick()
    for (let i = 0; i < IDLE_DEVICE_CHECK_EVERY - 1; i += 1) await tick(POLL_INTERVAL_MS)

    expect(api.urls('get_view_state')).toHaveLength(1)
  })

  it('keeps an open session through one parked answer', async () => {
    vi.setSystemTime(new Date('2026-08-02T21:00:00Z'))
    const api = stubRoutes(activeRoutes())
    const { result } = renderHook(() => useLiveSession())
    await tick()

    api.routes['/api/get_view_state'] = ok(recordedParkedViewState())
    await tick(POLL_INTERVAL_MS)
    expect(result.current.phase).toBe('idle')

    api.routes['/api/get_view_state'] = ok(recordedViewState())
    await tick(POLL_INTERVAL_MS)
    const state = result.current
    if (state.phase !== 'active') throw new Error('expected active')
    expect(state.log).toHaveLength(2)
    const starts = api.urls('check_night_guardrails').map(sessionStartOf)
    expect(starts[starts.length - 1]).toBe('2026-08-02T21:00:00.000Z')
  })

  it('ends an open session on two parked answers in a row, as it does on two `result: {}` answers', async () => {
    vi.setSystemTime(new Date('2026-08-02T21:00:00Z'))
    const api = stubRoutes(activeRoutes())
    const { result } = renderHook(() => useLiveSession())
    await tick()

    api.routes['/api/get_view_state'] = ok(recordedParkedViewState())
    await tick(POLL_INTERVAL_MS)
    await tick(POLL_INTERVAL_MS)

    api.routes['/api/get_view_state'] = ok(recordedViewState())
    await tick(POLL_INTERVAL_MS)
    const state = result.current
    if (state.phase !== 'active') throw new Error('expected active')
    expect(state.log).toHaveLength(1)
    expect(state.stageHistory).toEqual(['Stack'])
    const starts = api.urls('check_night_guardrails').map(sessionStartOf)
    expect(Date.parse(starts[starts.length - 1])).toBe(Date.parse('2026-08-02T21:00:00Z') + 3 * POLL_INTERVAL_MS)
  })
})
