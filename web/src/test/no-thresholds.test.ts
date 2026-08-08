// @vitest-environment node
//
// Pure file I/O — walks src/ and regex-matches every file. It imports nothing
// from the DOM, so the default jsdom environment was ~1.7s of setup bought for
// nothing. Under load that overhead pushed this test past the 5s default
// timeout and failed a suite that had no actual defect (observed 2026-08-08
// under four concurrent runs: 6.1s, "Test timed out in 5000ms").
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..')

/**
 * QA thresholds are owned by the server (SeeStar-AI config.py) and are
 * session-relative — two nights can reject at different absolute numbers.
 *
 * This is a deny-list of the distinctive eccentricity constants, NOT proof of
 * full coverage: altitude floor/ceiling degrees (20/60) are too generic to grep
 * for without false positives. Those rest on the convention that all site
 * geometry is read from get_site_profile, enforced by review.
 */
const FORBIDDEN = ['0.575', '0.42']

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx|css)$/.test(entry) && !full.includes('no-thresholds') ? [full] : []
  })
}

describe('QA thresholds', () => {
  it.each(FORBIDDEN)('never hardcodes %s', (literal) => {
    const offenders = sourceFiles(SRC).filter((file) =>
      readFileSync(file, 'utf8').includes(literal),
    )
    expect(offenders).toEqual([])
  })
})
