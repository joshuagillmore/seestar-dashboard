import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  fetchConditions,
  fetchFocuserPosition,
  fetchGuardrails,
  fetchLivePreview,
  fetchPlan,
  fetchStatus,
  fetchTargetObservability,
  fetchTier1,
  fetchViewState,
} from './client'
import {
  liveFocuserPosition,
  liveGuardrails,
  livePreviewStacked,
  liveStatus,
  liveTargetObservability,
  liveTier1,
  liveViewState,
  recordedConditions,
  recordedPlan,
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
    expect(spy).toHaveBeenCalledWith('/api/plan_targets?limit=3')
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
    it('parses a good get_view_state response, including the nested Stack/Annotate', async () => {
      mockFetch(liveViewState())
      const viewState = await fetchViewState()
      expect(viewState.result?.View?.Stack?.stacked_frame).toBe(428)
    })

    it('parses get_status', async () => {
      mockFetch(liveStatus())
      expect((await fetchStatus()).connected).toBe(true)
    })

    it('parses check_night_guardrails', async () => {
      mockFetch(liveGuardrails())
      expect((await fetchGuardrails()).verdict).toBe('continue')
    })

    it('parses qa_tier1', async () => {
      mockFetch(liveTier1())
      expect((await fetchTier1()).stacked_frame).toBe(428)
    })

    it('parses get_focuser_position', async () => {
      mockFetch(liveFocuserPosition())
      expect((await fetchFocuserPosition()).position).toBe(1645)
    })

    it('parses get_target_observability', async () => {
      mockFetch(liveTargetObservability())
      expect((await fetchTargetObservability()).in_sweet_band).toBe(true)
    })

    it('parses live_preview', async () => {
      mockFetch(livePreviewStacked())
      expect((await fetchLivePreview()).source).toBe('stacked')
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
