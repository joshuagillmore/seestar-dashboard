import { describe, expect, it } from 'vitest'

import { IDLE_DEVICE_CHECK_EVERY, POLL_INTERVAL_MS, shouldCheckDevice } from './useLiveSession'

/**
 * The idle-path back-off.
 *
 * We measured our own client polling `get_status` (5 bridge requests) plus
 * `get_view_state` (1) every 60 s against a **parked** scope, indefinitely,
 * and handed that to seestar-mcp as our own worst finding. This is the fix.
 *
 * The safety property is asymmetric and the tests are written around it: an
 * unnecessary device check costs six bridge requests, while a wrongly-skipped
 * one means a live session the screen never shows. So every uncertain answer
 * checks.
 */
describe('shouldCheckDevice', () => {
  it('always checks when a run is active', () => {
    for (const ticks of [0, 1, 2, 7, 100]) {
      expect(shouldCheckDevice('active', ticks)).toBe(true)
    }
  })

  it('always checks on unknown — a stale stamp is not "the scope is free"', () => {
    // The whole reason the server made this tri-valued. A run was recorded
    // and its writer may have died with the mount still tracking; backing off
    // there would be the confident wrong answer in a new place.
    for (const ticks of [0, 1, 2, 7, 100]) {
      expect(shouldCheckDevice('unknown', ticks)).toBe(true)
    }
  })

  it('fails open when get_run_state itself is unavailable', () => {
    // An older server, a transport hiccup, a route that 404s. Losing the
    // optimisation is the correct trade against hiding a session.
    for (const ticks of [0, 1, 2, 7, 100]) {
      expect(shouldCheckDevice(null, ticks)).toBe(true)
    }
  })

  it('checks on the FIRST idle poll, so opening mid-session is immediate', () => {
    // run_state.json only exists for skill-driven runs, so `idle` cannot rule
    // out a session started by hand from the phone app. The first poll must
    // always ask the scope.
    expect(shouldCheckDevice('idle', 1)).toBe(true)
  })

  it('then checks only every Nth poll while idle continues', () => {
    const checked = []
    for (let tick = 1; tick <= 16; tick += 1) {
      if (shouldCheckDevice('idle', tick)) checked.push(tick)
    }

    expect(checked).toEqual([1, 6, 11, 16])
  })

  it('cuts a parked scope from ~6 bridge requests a minute to ~1.2', () => {
    // The number that made this worth doing, asserted rather than claimed in
    // a comment. get_status is 5 requests and get_view_state is 1.
    const REQUESTS_PER_CHECK = 6
    const pollsPerHour = 3_600_000 / POLL_INTERVAL_MS

    let checks = 0
    for (let tick = 1; tick <= pollsPerHour; tick += 1) {
      if (shouldCheckDevice('idle', tick)) checks += 1
    }

    const before = pollsPerHour * REQUESTS_PER_CHECK
    const after = checks * REQUESTS_PER_CHECK

    expect(before).toBe(360)
    expect(after).toBeLessThanOrEqual(before / 4)
  })

  it('restores full cadence the moment idle stops — the caller resets the count', () => {
    // The back-off lives in the tick counter, which useLiveSession zeroes on
    // any non-idle answer. Pinning the contract that makes that reset work:
    // tick 1 always checks, so a reset is indistinguishable from a fresh
    // mount.
    expect(shouldCheckDevice('idle', 1)).toBe(true)
    expect(shouldCheckDevice('active', 1)).toBe(true)
  })

  it('the interval is a whole number of polls', () => {
    // Guards a future edit setting it to something that makes the modulo
    // arithmetic above meaningless.
    expect(Number.isInteger(IDLE_DEVICE_CHECK_EVERY)).toBe(true)
    expect(IDLE_DEVICE_CHECK_EVERY).toBeGreaterThan(1)
  })
})
