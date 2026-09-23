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
  sessionActivity,
} from '../../test/fixtures'
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
    mock,
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
