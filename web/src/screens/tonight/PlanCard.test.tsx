import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PlanCard } from './PlanCard'
import { PlanTargetsSchema } from '../../api/schemas'
import { recordedPlan } from '../../test/fixtures'

const [target] = PlanTargetsSchema.parse(recordedPlan()).targets

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

  it('renders no thumbnail and no filter chip, since neither has a source', () => {
    const { container } = render(<PlanCard target={target} />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.queryByText(/^LP /)).not.toBeInTheDocument()
    expect(screen.getByText(target.type)).toBeInTheDocument()
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
})
