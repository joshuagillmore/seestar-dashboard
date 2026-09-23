import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  lastStackFound,
  livePreviewStacked,
  recordedFocuserPosition,
  recordedGuardrails,
  recordedObservability,
  recordedStatus,
  recordedTier1,
  recordedViewState,
  runStateIdle,
  sessionActivity,
} from '../../test/fixtures'
import { REQUEST_TIMEOUT_MS } from '../../api/client'
import { POLL_INTERVAL_MS, useLiveSession } from './useLiveSession'

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

/** Scope connected, no view session: `result: {}` (hardware, 2026-07-31). */
const noView = () => ({ ok: true, view_state: { method: 'get_view_state', result: {}, code: 0 } })

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
    ['get_view_state reports no View', () => ok(noView())],
    ['get_view_state times out while get_status answers', () => fail('get_view_state timed out')],
  ])('starts the next night from scratch when the scope went idle in between (%s)', async (_label, idleReply) => {
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
    expect(result.current.phase).toBe('idle')

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

    api.routes['/api/get_view_state'] = ok(noView())
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
    expect(result.current.phase).toBe('bridge-down')

    vi.setSystemTime(new Date('2026-08-03T21:00:00Z'))
    api.routes['/api/get_view_state'] = ok(recordedViewState())
    await tick(POLL_INTERVAL_MS)

    const starts = api.urls('check_night_guardrails').map(sessionStartOf)
    expect(Date.parse(starts[starts.length - 1])).toBeGreaterThanOrEqual(Date.parse('2026-08-03T21:00:00Z'))
  })
})
