import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  fetchConditions,
  fetchFocuserPosition,
  fetchGuardrails,
  fetchLivePreview,
  fetchPlan,
  fetchSessionActivity,
  fetchStatus,
  fetchTargetObservability,
  fetchTier1,
  fetchViewState,
  REQUEST_TIMEOUT_MS,
  SchemaError,
} from './client'
import {
  livePreviewStacked,
  recordedConditions,
  recordedFocuserPosition,
  recordedGuardrails,
  recordedObservability,
  recordedPlan,
  recordedStatus,
  recordedTier1,
  recordedViewState,
  sessionActivity,
} from '../test/fixtures'

const mockFetch = (body: unknown, status = 200) =>
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => body,
  }))

afterEach(() => vi.unstubAllGlobals())

describe('api client', () => {
  it('parses a good response', async () => {
    mockFetch(recordedConditions())
    expect((await fetchConditions()).go).toBe(false)
  })

  it('raises ApiError with the sidecar message on 502', async () => {
    mockFetch({ ok: false, error: 'subprocess died' }, 502)
    await expect(fetchConditions()).rejects.toThrow(/subprocess died/)
  })

  it('raises ApiError when the payload fails schema validation', async () => {
    mockFetch({ ok: true, go: 'yes' })
    await expect(fetchConditions()).rejects.toBeInstanceOf(ApiError)
  })

  it('raises the distinct SchemaError for a payload it cannot parse, so a caller can tell "answered oddly" from "did not answer"', async () => {
    // The Live screen read every get_view_state failure as "scope idle",
    // including a schema mismatch — and that misreport happened on hardware
    // (see AnnotateSchema's doc comment): idle, while stacking 94 frames.
    mockFetch({ ok: true, go: 'yes' })
    await expect(fetchConditions()).rejects.toBeInstanceOf(SchemaError)
    await expect(fetchConditions()).rejects.toThrow(/unexpected payload/)
  })

  it('does not call a transport or tool failure a SchemaError', async () => {
    mockFetch({ ok: false, error: 'get_view_state timed out' }, 502)
    await expect(fetchViewState()).rejects.not.toBeInstanceOf(SchemaError)
    mockFetch({ ok: false, error: 'no site profile has been set' })
    await expect(fetchConditions()).rejects.not.toBeInstanceOf(SchemaError)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    await expect(fetchConditions()).rejects.not.toBeInstanceOf(SchemaError)
  })

  it('puts the limit in the plan query string', async () => {
    // fetchPlan is the only wrapper with interpolation. A typo here yields a
    // URL the sidecar 404s or silently ignores, and nothing else would catch it.
    const spy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => recordedPlan(),
    })
    vi.stubGlobal('fetch', spy)
    await fetchPlan(3)
    expect(spy.mock.calls[0][0]).toBe('/api/plan_targets?limit=3')
  })

  describe('timeouts and cancellation', () => {
    afterEach(() => vi.useRealTimers())

    it('gives up on a request the sidecar never answers, instead of hanging the caller', async () => {
      // No timeout used to exist. The sidecar serialises MCP calls, so one
      // slow call held every later one, and the Live screen's polls piled up
      // behind it.
      vi.useFakeTimers()
      vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})))
      const pending = fetchViewState()
      const settled = expect(pending).rejects.toThrow(/did not answer .*get_view_state/)
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS)
      await settled
      await expect(pending).rejects.toBeInstanceOf(ApiError)
      await expect(pending).rejects.not.toBeInstanceOf(SchemaError)
    })

    it('hands fetch a signal, and aborts it when the timeout fires', async () => {
      vi.useFakeTimers()
      const spy = vi.fn((_url: string, _init?: RequestInit) => new Promise(() => {}))
      vi.stubGlobal('fetch', spy)
      const pending = fetchStatus().catch(() => null)
      const signal = spy.mock.calls[0][1]?.signal
      expect(signal).toBeInstanceOf(AbortSignal)
      expect(signal?.aborted).toBe(false)
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS)
      await pending
      expect(signal?.aborted).toBe(true)
    })

    it('cancels when the caller aborts, without waiting for the timeout', async () => {
      const spy = vi.fn((_url: string, _init?: RequestInit) => new Promise(() => {}))
      vi.stubGlobal('fetch', spy)
      const caller = new AbortController()
      const pending = fetchViewState({ signal: caller.signal })
      caller.abort()
      await expect(pending).rejects.toBeInstanceOf(ApiError)
      expect(spy.mock.calls[0][1]?.signal?.aborted).toBe(true)
    })

    it('leaves no timer behind once the response has arrived', async () => {
      vi.useFakeTimers()
      mockFetch(recordedStatus())
      await fetchStatus()
      expect(vi.getTimerCount()).toBe(0)
    })
  })

  it('raises ApiError when the sidecar cannot be reached at all', async () => {
    // A fourth failure mode, distinct from the sidecar's own 502: the browser
    // never reaches it. Task 13 renders this as the screen-level error banner.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')))
    await expect(fetchConditions()).rejects.toThrow(/unreachable/)
  })

  it('names the sidecar and what to do when a dead sidecar resolves as a bare 502', async () => {
    // This is the case the reject-based test above does NOT cover, and the
    // one that actually happens in the dev setup: Vite's proxy in front of a
    // stopped sidecar makes fetch *resolve* with a 502 and an HTML body, not
    // reject. .json() on that body fails, which used to fall through to the
    // bare, useless "HTTP 502".
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON')),
    }))
    await expect(fetchConditions()).rejects.toThrow(/sidecar/i)
    await expect(fetchConditions()).rejects.toThrow(/uv run seestar-dashboard/)
    await expect(fetchConditions()).rejects.not.toThrow(/^HTTP 502$/)
  })

  it('surfaces a tool-level failure message, not a schema complaint', async () => {
    // The sidecar forwards {ok: false} at HTTP 200 — the tool ran and reported
    // a problem. Blaming the payload shape would hide the real reason.
    mockFetch({ ok: false, error: 'no site profile has been set' })
    await expect(fetchConditions()).rejects.toThrow(/no site profile has been set/)
    await expect(fetchConditions()).rejects.not.toThrow(/unexpected payload/)
  })

  describe('live-session fetchers (slice 3)', () => {
    it('parses a good get_view_state response, including the real view_state.result.View.Stack nesting', async () => {
      mockFetch(recordedViewState())
      const viewState = await fetchViewState()
      expect(viewState.view_state?.result?.View?.Stack?.stacked_frame).toBe(115)
    })

    it('parses get_status', async () => {
      mockFetch(recordedStatus())
      expect((await fetchStatus()).connected).toBe(true)
    })

    it('puts session_start_utc in the check_night_guardrails query string', async () => {
      const spy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => recordedGuardrails() })
      vi.stubGlobal('fetch', spy)
      await fetchGuardrails('2026-07-30T03:00:00.000Z')
      expect(spy.mock.calls[0][0]).toBe(
        '/api/check_night_guardrails?session_start_utc=2026-07-30T03%3A00%3A00.000Z',
      )
    })

    it('parses check_night_guardrails\' real flat shape', async () => {
      mockFetch(recordedGuardrails())
      expect((await fetchGuardrails('2026-07-30T03:00:00.000Z')).action).toBe('continue')
    })

    it('parses qa_tier1', async () => {
      mockFetch(recordedTier1())
      expect((await fetchTier1()).snapshot.stacked).toBe(115)
    })

    it('parses get_focuser_position', async () => {
      mockFetch(recordedFocuserPosition())
      expect((await fetchFocuserPosition()).focus_pos).toBe(1830)
    })

    it('puts the target id in the get_target_observability query string', async () => {
      const spy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => recordedObservability() })
      vi.stubGlobal('fetch', spy)
      await fetchTargetObservability('M27')
      expect(spy.mock.calls[0][0]).toBe('/api/get_target_observability?target=M27')
    })

    it('parses get_target_observability', async () => {
      mockFetch(recordedObservability())
      expect((await fetchTargetObservability('M27')).observability?.max_alt_deg).toBe(61.4)
    })

    it('parses live_preview', async () => {
      mockFetch(livePreviewStacked())
      expect((await fetchLivePreview()).source).toBe('stacked')
    })

    it('puts the limit in the session_activity query string', async () => {
      const spy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => sessionActivity() })
      vi.stubGlobal('fetch', spy)
      await fetchSessionActivity(30)
      expect(spy.mock.calls[0][0]).toBe('/api/session_activity?limit=30')
    })

    it('parses session_activity, including a fully-null unknown record', async () => {
      mockFetch(sessionActivity())
      const activity = await fetchSessionActivity(30)
      expect(activity.records.map((r) => r.origin)).toEqual([
        'console',
        'agent',
        'ambiguous',
        'unknown',
      ])
      expect(activity.records[3].tool).toBeNull()
    })

    it('raises ApiError (not a hang) when get_view_state times out on an idle scope — the sidecar 502s, it does not leave the request open', async () => {
      // The spec is explicit that state methods time out on an idle scope,
      // but that means the SIDECAR's call to the MCP tool times out — the
      // HTTP response to the browser still comes back promptly as a 502 (see
      // routes.py's _serve). This client has no special-cased "wait longer"
      // path; a slow upstream is just another ApiError to the caller.
      mockFetch({ ok: false, error: 'get_view_state timed out — scope not observing' }, 502)
      await expect(fetchViewState()).rejects.toBeInstanceOf(ApiError)
      await expect(fetchViewState()).rejects.toThrow(/timed out/)
    })
  })
})
