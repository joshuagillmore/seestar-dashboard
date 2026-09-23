import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GuardrailsSchema } from '../../api/schemas'
import { recordedGuardrails } from '../../test/fixtures'
import { GuardrailsCard } from './GuardrailsCard'

/**
 * seestar-mcp builds the verdict as `reasons = hard_stops + reasons`
 * (planning/autonomous.py): every hard stop is ALSO the head of `reasons`.
 * Rendering both lists verbatim showed each blocking reason twice — once
 * weighted as a hard stop, once again as "context".
 */
const parkAndStop = GuardrailsSchema.parse({
  ...(recordedGuardrails() as object),
  proceed: false,
  action: 'park_and_stop',
  hard_stops: ['Scope not connected'],
  reasons: ['Scope not connected', 'Weather unverified — observability-only, not a hard stop'],
})

describe('GuardrailsCard', () => {
  it('shows each hard stop once, not again among the context reasons', () => {
    render(<GuardrailsCard guardrails={parkAndStop} />)
    expect(screen.getAllByText('Scope not connected')).toHaveLength(1)
    expect(screen.getByText('Weather unverified — observability-only, not a hard stop')).toBeInTheDocument()
  })

  it('shows no context list at all when every reason is a hard stop', () => {
    const onlyStops = GuardrailsSchema.parse({ ...parkAndStop, reasons: ['Scope not connected'] })
    const { container } = render(<GuardrailsCard guardrails={onlyStops} />)
    expect(screen.getAllByText('Scope not connected')).toHaveLength(1)
    expect(container.querySelectorAll('li')).toHaveLength(1)
  })

  it('renders the recorded all-clear verdict verbatim', () => {
    render(<GuardrailsCard guardrails={GuardrailsSchema.parse(recordedGuardrails())} />)
    expect(screen.getByText('continue')).toBeInTheDocument()
  })
})
