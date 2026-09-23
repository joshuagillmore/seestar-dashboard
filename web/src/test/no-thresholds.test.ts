// @vitest-environment node
//
// Pure file I/O — walks src/ and reads every number out of every file. It
// imports nothing from the DOM, so the default jsdom environment was ~1.7s of
// setup bought for nothing. Under load that overhead pushed this test past the
// 5s default timeout and failed a suite that had no actual defect (observed
// 2026-08-08 under four concurrent runs: 6.1s, "Test timed out in 5000ms").
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..')

/**
 * QA thresholds are owned by the server (SeeStar-AI config.py) and are mostly
 * session-relative: two nights can reject at different absolute numbers. The
 * UI reads them from `summary.thresholds` and never writes them down.
 *
 * This is a DENY-LIST of the two distinctive eccentricity constants. It does
 * not prove that no threshold is hardcoded. It reads every number in every
 * ts/tsx/css file under src/ and compares its VALUE with them, so `.575`,
 * `0.5750` and `575e-3` are caught and `10.42` is not. The comparison uses a
 * tolerance of 1e-9, which only absorbs float representation: `0.5749` is a
 * different number and passes.
 *
 * Comments are scanned as well as code, strings and JSX text. A threshold
 * written into a comment goes stale as silently as one written into code.
 *
 * What it cannot see, stated so nobody mistakes a green run for more than it is:
 * - thresholds that are not these two numbers. The session-relative ones have
 *   no constant to look for, and the altitude band (20/60 degrees) is too
 *   generic to deny without false positives. That relies on the convention that
 *   site geometry comes from get_site_profile, enforced by review.
 * - the same value reached by arithmetic (`0.5 + 0.075`) or written in another
 *   unit (57.5 as a percent).
 * - anything outside ts/tsx/css under src/. fixtures/ carries the server's real
 *   numbers on purpose, as recorded data.
 */
const FORBIDDEN = [0.575, 0.42]
const TOLERANCE = 1e-9

/**
 * Files that must contain a forbidden value, with the reason. Paths are
 * relative to src/, with forward slashes on every OS. An entry whose file no
 * longer needs it fails the suite: a stale entry is a hole a real offender
 * could later hide in.
 */
const ALLOWED: Record<string, string> = {
  'test/no-thresholds.test.ts':
    'defines the deny-list, and feeds the scanner the spellings it must catch',
}

interface Hit {
  line: number
  text: string
  value: number
}

// One number, in any spelling JS or CSS accepts for a decimal: `0.575`, `.575`,
// `0.5750`, `575e-3`, `0.57_5`. The lookbehind stops a match starting
// mid-identifier or mid-number, so `h1.42`, `x.575` and the `.42` inside
// `10.42` are not read as numbers. There is deliberately no lookahead: a unit
// (`0.42rem`) or a sentence's full stop ("above 0.575.") must not hide the
// number in front of it.
const NUMBER = /(?<![\w$.])(?:\d[\d_]*(?:\.[\d_]*)?|\.\d[\d_]*)(?:[eE][+-]?\d+)?/g

/** Every number in a file's text whose value is one of the forbidden constants. */
function forbiddenIn(source: string): Hit[] {
  return Array.from(source.matchAll(NUMBER), (m) => ({
    line: source.slice(0, m.index).split('\n').length,
    text: m[0],
    value: Number(m[0].replace(/_/g, '')),
  })).filter(({ value }) => FORBIDDEN.some((f) => Math.abs(value - f) < TOLERANCE))
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(ts|tsx|css)$/.test(entry) ? [full] : []
  })
}

const scanned = sourceFiles(SRC).map((file) => ({
  file: relative(SRC, file).split(sep).join('/'),
  hits: forbiddenIn(readFileSync(file, 'utf8')),
}))

describe('QA thresholds', () => {
  it.each(FORBIDDEN)('never hardcodes %s, in any spelling', (constant) => {
    const offenders = scanned
      .filter(({ file }) => !(file in ALLOWED))
      .flatMap(({ file, hits }) =>
        hits
          .filter(({ value }) => Math.abs(value - constant) < TOLERANCE)
          .map(({ line, text }) => `${file}:${line} ${text}`),
      )
    expect(offenders).toEqual([])
  })

  it('allowlists only files that exist and still need it', () => {
    for (const file of Object.keys(ALLOWED)) {
      expect(existsSync(join(SRC, file)), `${file} is allowlisted but missing`).toBe(true)
      const entry = scanned.find((s) => s.file === file)
      expect(entry?.hits.length, `${file} no longer needs its allowlist entry`).toBeGreaterThan(0)
    }
  })
})

describe('the number scanner', () => {
  const values = (source: string) => forbiddenIn(source).map((h) => h.value)

  it('catches every spelling of the same value', () => {
    for (const spelling of ['0.575', '.575', '0.5750', '575e-3', '5.75E-1', '0.57_5', '0.42', '.42', '42e-2']) {
      expect(values(`export const x = ${spelling}`), spelling).toHaveLength(1)
    }
  })

  it('reads strings, template literals, JSX text and CSS', () => {
    expect(values(`const a = 'REJECT above .575.'`)).toEqual([0.575])
    expect(values('const b = `cutoff ${n} vs 0.4200`')).toEqual([0.42])
    expect(values('const c = <p>ecc 0.575</p>')).toEqual([0.575])
    expect(values('.a { opacity: .575; margin: 0.42rem; }')).toEqual([0.575, 0.42])
  })

  it('reads comments too', () => {
    expect(values('// cutoff .575\nconst x = 1')).toEqual([0.575])
    expect(values('/* 42e-2 */ .a { opacity: 1; }')).toEqual([0.42])
  })

  it('does not flag near neighbours', () => {
    const source = `const n = [10.42, 0.425, 1.575, 57.5, 42, 0.5749]; const s = 'x.575 h1.42 #575'`
    expect(values(source)).toEqual([])
  })

  it('reports the line a hit is on', () => {
    const [hit] = forbiddenIn('const a = 1\n\nconst b = `x\n.42`')
    expect(hit?.line).toBe(4)
  })
})
