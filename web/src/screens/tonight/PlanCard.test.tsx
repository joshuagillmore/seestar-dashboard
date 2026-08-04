import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PlanCard, type PlanCardProgress } from './PlanCard'
import { targetTypeLabel } from './targetType'
import { PlanTargetsSchema, type IntegrationGoal } from '../../api/schemas'
import { recordedPlan } from '../../test/fixtures'

const [target] = PlanTargetsSchema.parse(recordedPlan()).targets

const goal = (overrides: Partial<IntegrationGoal> = {}): IntegrationGoal => ({
  track: 'photometric',
  suggested_hours: 3.0,
  coarse: false,
  beyond_reach: false,
  surface_brightness: 23.3,
  bortle_multiplier: 1.0,
  reason: null,
  note: 'SB 23.30 mag/arcsec² → suggested 3.0 h.',
  ...overrides,
})

describe('PlanCard', () => {
  it('shows the id, name and score', () => {
    render(<PlanCard target={target} />)
    expect(screen.getByText(target.id)).toBeInTheDocument()
    expect(screen.getByText(target.name)).toBeInTheDocument()
    expect(screen.getByText(String(target.score))).toBeInTheDocument()
  })

  it('drops the reason that merely repeats the window', () => {
    render(<PlanCard target={target} />)
    expect(screen.queryByText(/^best window /)).not.toBeInTheDocument()
    expect(screen.getByText(/sweet-band time/)).toBeInTheDocument()
  })

  it('renders the empty thumbnail placeholder (no <img>) when the fixture carries no image data, and no filter chip either, since neither has a source', () => {
    const { container } = render(<PlanCard target={target} />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.getByTestId('thumb-empty')).toBeInTheDocument()
    expect(screen.queryByText(/^LP /)).not.toBeInTheDocument()
    expect(screen.getByText(targetTypeLabel(target.type))).toBeInTheDocument()
  })

  describe('the type chip', () => {
    it('shows the coarse family label, not the raw snake_case TARGET_TYPES value', () => {
      // The recorded fixture's first target is a planetary_nebula — asserting
      // against the raw fixture value keeps this honest if the fixture is
      // ever re-recorded with a different target in slot 0.
      expect(target.type).toBe('planetary_nebula')
      render(<PlanCard target={target} />)
      expect(screen.getByText('nebula')).toBeInTheDocument()
      expect(screen.queryByText('planetary_nebula')).not.toBeInTheDocument()
    })

    it('falls through an unrecognised type to a legible label rather than blank', () => {
      render(<PlanCard target={{ ...target, type: 'dark_nebula' }} />)
      expect(screen.getByText('dark nebula')).toBeInTheDocument()
    })
  })

  it('renders the own capture with no survey marker when the target carries an own image', () => {
    const withImage = { ...target, image: { url: '/api/target_image/M76', source: 'own' as const, credit: null } }
    render(<PlanCard target={withImage} />)
    expect(screen.getByRole('img', { name: target.name })).toHaveAttribute('src', '/api/target_image/M76')
    expect(screen.queryByTestId('survey-badge')).not.toBeInTheDocument()
  })

  it('renders a survey image with the SURVEY marker and the credit reachable on hover', () => {
    const withImage = {
      ...target,
      image: { url: '/api/target_image/M76', source: 'survey' as const, credit: 'DSS2 · STScI' },
    }
    render(<PlanCard target={withImage} />)
    expect(screen.getByRole('img', { name: target.name })).toBeInTheDocument()
    const badge = screen.getByTestId('survey-badge')
    expect(badge).toHaveTextContent('SURVEY')
    expect(badge).toHaveAttribute('title', 'DSS2 · STScI')
  })

  it('disables the hand-off action until the approval gate exists', () => {
    render(<PlanCard target={target} />)
    expect(screen.getByRole('button', { name: /Hand to run-session/ })).toBeDisabled()
  })

  it('labels the best-window stat with the zone it is actually rendering, not a bare "local"', () => {
    // Timezone-independent: asserts the shape (see timeline.test.ts's
    // formatUtcOffset suite for the value-level coverage), not a value pinned
    // to whatever zone happens to run this test.
    render(<PlanCard target={target} />)
    expect(screen.getByText(/^BEST WINDOW UTC([+-]\d{1,2}(:\d{2})?)?$/)).toBeInTheDocument()
  })

  it('shows recommended subs and exposure', () => {
    render(<PlanCard target={target} />)
    expect(
      screen.getByText(`${target.recommended_subs} × ${target.recommended_exposure_s} s`),
    ).toBeInTheDocument()
  })

  it('renders no progress row at all when the target has no projects_combined entry', () => {
    render(<PlanCard target={target} />)
    expect(screen.queryByTestId('plan-progress-track')).not.toBeInTheDocument()
    expect(screen.queryByText(/TIME CAPTURED/)).not.toBeInTheDocument()
  })

  it('renders a progress row with the real hours captured and an empty rail when there is no numeric goal', () => {
    const progress: PlanCardProgress = { totalMinutes: 89.1667, goal: null }
    render(<PlanCard target={target} progress={progress} />)
    expect(screen.getByText('TIME CAPTURED')).toBeInTheDocument()
    expect(screen.getByText('1.5 h')).toBeInTheDocument()
    expect(screen.getByText('not in DSO catalogue')).toBeInTheDocument()
    expect(screen.getByTestId('plan-progress-track').firstElementChild).toBeNull()
  })

  it('renders a proportional fill and the suggested-hours label when a real goal exists', () => {
    const progress: PlanCardProgress = { totalMinutes: 90, goal: goal({ suggested_hours: 3.0 }) } // 90/180=50%
    render(<PlanCard target={target} progress={progress} />)
    expect(screen.getByText('1.5 h')).toBeInTheDocument()
    expect(screen.getByText('of 3.0 h suggested')).toBeInTheDocument()
    const fill = screen.getByTestId('plan-progress-track').firstElementChild as HTMLElement
    expect(fill.style.width).toBe('50%')
  })

  it('never renders the doubling control here — that is a Projects-screen-only concept', () => {
    const progress: PlanCardProgress = { totalMinutes: 90, goal: goal({ suggested_hours: 3.0 }) }
    render(<PlanCard target={target} progress={progress} />)
    expect(screen.queryByRole('button', { name: /Double/ })).not.toBeInTheDocument()
  })

  describe('action hover states', () => {
    // jsdom does not evaluate :hover, so this reads the actual CSS Module
    // source (the same technique test/tokens.test.ts already uses to check
    // for hex literals) and asserts the real declared rule and token, not
    // just that the word "hover" appears somewhere in the file.
    const css = readFileSync(join(__dirname, 'PlanCard.module.css'), 'utf8')

    it('hovers the primary (Hand to run-session) action to accent/hover, only while enabled', () => {
      expect(css).toMatch(/\.primary:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--accent-hover\)/)
    })

    it('brightens the secondary (Detail) action border and text on hover', () => {
      expect(css).toMatch(/\.secondary:hover\s*\{[^}]*border-color:\s*var\(--border-control-hover\)/)
      expect(css).toMatch(/\.secondary:hover\s*\{[^}]*color:\s*var\(--text-primary\)/)
    })
  })

  describe('Detail', () => {
    // Was a dead button for four slices: rendered, enabled, wired to nothing.
    // It now opens the target's Review & QA report — but only when there is a
    // report to open, which is the minority case on a planner shortlist.
    it('opens the target on Review & QA when there are subs on disk', () => {
      const onOpenQa = vi.fn()
      render(<PlanCard target={target} onOpenQa={onOpenQa} />)

      const detail = screen.getByRole('button', { name: 'Detail' })
      expect(detail).toBeEnabled()
      fireEvent.click(detail)

      expect(onOpenQa).toHaveBeenCalledTimes(1)
    })

    it('disables itself, and says why, when the archive holds nothing', () => {
      // The ordinary case: the planner suggests targets precisely because you
      // have not shot them. Navigating anyway would land on Review with the
      // handoff silently dropped (useQaReview only selects a target it can
      // find), which reads as a broken button.
      render(<PlanCard target={target} />)

      const detail = screen.getByRole('button', { name: 'Detail' })
      expect(detail).toBeDisabled()
      expect(detail).toHaveAttribute('title', expect.stringContaining('nothing to review'))
    })

    it('names the target in both titles, so the tooltip is not generic', () => {
      const { rerender } = render(<PlanCard target={target} onOpenQa={vi.fn()} />)
      expect(screen.getByRole('button', { name: 'Detail' }).getAttribute('title')).toContain(target.id)

      rerender(<PlanCard target={target} />)
      expect(screen.getByRole('button', { name: 'Detail' }).getAttribute('title')).toContain(target.id)
    })
  })

})
