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
const TOKENS = join(SRC, 'tokens.css')
const HEX = /#[0-9a-fA-F]{3,8}\b/g

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx|css)$/.test(entry) && full !== TOKENS ? [full] : []
  })
}

describe('design tokens', () => {
  it('defines all 52 colour tokens from the handoff table', () => {
    const declared = readFileSync(TOKENS, 'utf8').match(/^\s*--[a-z0-9-]+:\s*#/gm) ?? []
    expect(declared).toHaveLength(52)
  })

  it('is the only file containing a hex colour literal', () => {
    const offenders = sourceFiles(SRC)
      .map((file) => ({ file, hits: readFileSync(file, 'utf8').match(HEX) }))
      .filter((entry) => entry.hits !== null)
    expect(offenders).toEqual([])
  })
})
