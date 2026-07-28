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
