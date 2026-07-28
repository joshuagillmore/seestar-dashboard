import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, fetchConditions } from './client'
import { recordedConditions } from '../test/fixtures'

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

  it('surfaces a tool-level failure message, not a schema complaint', async () => {
    // The sidecar forwards {ok: false} at HTTP 200 — the tool ran and reported
    // a problem. Blaming the payload shape would hide the real reason.
    mockFetch({ ok: false, error: 'no site profile has been set' })
    await expect(fetchConditions()).rejects.toThrow(/no site profile has been set/)
    await expect(fetchConditions()).rejects.not.toThrow(/unexpected payload/)
  })
})
