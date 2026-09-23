import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { recordedSite } from '../test/fixtures'
import { useShellData } from './useShellData'

/**
 * Shell data is fetched once per tab, so a sidecar that is not up yet at
 * first load used to leave `site` (which gates the Live screen's sweet-band
 * gauge) and the replay badge null for the tab's whole life — and
 * Promise.all meant one failing route blanked the other too.
 */

type Reply = { ok: boolean; status: number; body: unknown }
const up = (body: unknown): Reply => ({ ok: true, status: 200, body })
const down: Reply = { ok: false, status: 502, body: null }
const HEALTH = { ok: true, replay: true }

function stubShell(replies: { site: () => Reply; health: () => Reply }) {
  const fetchMock = vi.fn(async (url: string) => {
    const reply = url === '/api/get_site_profile' ? replies.site() : replies.health()
    return { ok: reply.ok, status: reply.status, json: async () => reply.body }
  })
  vi.stubGlobal('fetch', fetchMock)
  return {
    calls: (path: string) => fetchMock.mock.calls.filter(([u]) => u === path).length,
  }
}

const tick = (ms = 0) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }))
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useShellData', () => {
  it('loads health even while the site profile is failing — one does not blank the other', async () => {
    stubShell({ site: () => down, health: () => up(HEALTH) })
    const { result } = renderHook(() => useShellData())
    await tick()

    expect(result.current.health).toEqual(HEALTH)
    expect(result.current.site).toBeNull()
  })

  it('retries until the sidecar answers, instead of staying null for the tab\'s life', async () => {
    let sidecarUp = false
    const api = stubShell({
      site: () => (sidecarUp ? up(recordedSite()) : down),
      health: () => (sidecarUp ? up(HEALTH) : down),
    })
    const { result } = renderHook(() => useShellData())
    await tick()
    expect(result.current.site).toBeNull()

    sidecarUp = true
    await tick(60_000)

    expect(result.current.site).not.toBeNull()
    expect(result.current.health).toEqual(HEALTH)
    // And stops once each has succeeded.
    const settled = api.calls('/api/get_site_profile')
    await tick(10 * 60_000)
    expect(api.calls('/api/get_site_profile')).toBe(settled)
  })

  it('backs off gently rather than hammering a sidecar that is down', async () => {
    const api = stubShell({ site: () => down, health: () => down })
    renderHook(() => useShellData())
    await tick()
    await tick(2_000)
    expect(api.calls('/api/get_site_profile')).toBeGreaterThan(1)

    await tick(10 * 60_000)
    // Doubling from a couple of seconds to a one-minute ceiling: ~15 tries in
    // ten minutes, not one every couple of seconds (~300).
    expect(api.calls('/api/get_site_profile')).toBeLessThanOrEqual(20)
  })

  it('stops retrying once unmounted', async () => {
    const api = stubShell({ site: () => down, health: () => down })
    const { unmount } = renderHook(() => useShellData())
    await tick()
    unmount()
    const before = api.calls('/api/get_site_profile')
    await tick(10 * 60_000)

    expect(api.calls('/api/get_site_profile')).toBe(before)
  })
})
