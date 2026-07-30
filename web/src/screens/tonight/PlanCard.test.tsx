import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PlanCard, type PlanCardProgress } from './PlanCard'
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
    expect(screen.getByText(target.type)).toBeInTheDocument()
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
})
