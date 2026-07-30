import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Sidebar } from '../shell/Sidebar'
import { Dot } from './Dot'

describe('Dot', () => {
  it('tags every tone with data-dot so tests can assert on dots', () => {
    const { rerender } = render(<Dot tone="pass" />)
    expect(screen.getByTestId('dot')).toHaveAttribute('data-dot', 'pass')
    rerender(<Dot tone="reject" />)
    expect(screen.getByTestId('dot')).toHaveAttribute('data-dot', 'reject')
  })

  it('supports the two sizes the design uses', () => {
    const { rerender } = render(<Dot tone="pass" />)
    const md = screen.getByTestId('dot').className
    rerender(<Dot tone="pass" size="sm" />)
    expect(screen.getByTestId('dot').className).not.toBe(md)
  })

  describe('className passthrough', () => {
    it('appends a caller class to its own, byte-for-byte, rather than replacing them', () => {
      // CSS Modules give tone/size classes opaque hashed names (e.g.
      // `_marginal_947f68`), so this compares against a same-props baseline
      // rendered with no className, rather than pattern-matching the hash —
      // the exact own-class string must survive untouched with the caller's
      // class appended after it, not merely "contain marginal somewhere".
      const { unmount } = render(<Dot tone="marginal" size="sm" />)
      const bare = screen.getByTestId('dot').className
      unmount()

      render(<Dot tone="marginal" size="sm" className="guardrailDot" />)
      expect(screen.getByTestId('dot').className).toBe(`${bare} guardrailDot`)
    })

    it('cannot let a caller override or remove the data-dot guarantee', () => {
      // DotProps has no `data-dot` field at all, so a normal caller can't even
      // author this — the guarantee is structural, not a runtime check. That
      // structure (destructure exactly {tone, size, className}, never spread a
      // rest object onto the element) is what a jsdom render can't observe
      // directly, so it's read from source — the same technique
      // PlanCard.test.tsx already uses for its hover-state CSS, for the same
      // reason: the property under test has no other way to be exercised.
      const src = readFileSync(join(__dirname, 'Dot.tsx'), 'utf8')
      expect(src).not.toMatch(/\{\.\.\.(rest|props|other)\}/)
      expect(src).toMatch(/data-dot=\{tone\}/)
    })

    it('still renders correctly through a real caller after the className change (Sidebar)', () => {
      // Regression coverage through an actual composition, not just the
      // isolated renders above — the goal-model incident this task's brief
      // cites was exactly a prop whose isolated tests all passed while no
      // real caller wiring was ever checked.
      render(
        <Sidebar
          site={null}
          verdict="GO"
          gpsWarning={null}
          gpsMatched={null}
          view="tonight"
          onNavigate={() => {}}
        />,
      )
      const dots = screen.getAllByTestId('dot')
      expect(dots[0]).toHaveAttribute('data-dot', 'pass')
    })
  })

  describe('pulse', () => {
    it('is off by default — no animation class on an ordinary dot', () => {
      render(<Dot tone="accent" />)
      expect(screen.getByTestId('dot').className).not.toMatch(/pulse/i)
    })

    it('adds the pulse class only when explicitly requested', () => {
      const { rerender } = render(<Dot tone="accent" />)
      const bare = screen.getByTestId('dot').className
      rerender(<Dot tone="accent" pulse />)
      const pulsing = screen.getByTestId('dot').className
      expect(pulsing).not.toBe(bare)
      expect(pulsing).toMatch(/pulse/i)
    })

    it('reads the same animation name tokens.css declares, so the two cannot drift apart silently', () => {
      // Dot.module.css names the keyframe by hand (`animation: livePulse ...`)
      // rather than importing it — nothing at build time would catch a typo
      // against tokens.css's own `@keyframes livePulse`. Cross-check both files.
      const dotCss = readFileSync(join(__dirname, 'Dot.module.css'), 'utf8')
      const tokensCss = readFileSync(join(__dirname, '..', 'tokens.css'), 'utf8')
      expect(tokensCss).toMatch(/@keyframes livePulse/)
      expect(dotCss).toMatch(/animation:\s*livePulse\b/)
    })
  })
})
