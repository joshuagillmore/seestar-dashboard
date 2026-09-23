import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { StackStateSchema, Tier1Schema, ViewStateSchema } from '../../api/schemas'
import { recordedTier1, recordedViewState } from '../../test/fixtures'
import { TelemetryGrid } from './TelemetryGrid'

const cell = (label: string) => screen.getByText(label).parentElement as HTMLElement

describe('TelemetryGrid INTEGRATION', () => {
  it('shows integration from the scope\'s own running exposure — not "not yet returned by any tool"', () => {
    // get_view_state has always carried View.Stack.Exposure.exp_ms; the
    // schema dropped it, so this cell claimed no tool returned it.
    const stack = ViewStateSchema.parse(recordedViewState()).view_state?.result?.View?.Stack ?? null
    render(
      <TelemetryGrid
        stack={stack}
        tier1={Tier1Schema.parse(recordedTier1())}
        focuser={null}
        stage="Stack"
        stageHistory={['Stack']}
      />,
    )
    const integration = cell('INTEGRATION')
    expect(within(integration).getByText('19.2 min')).toBeInTheDocument()
    expect(integration).toHaveTextContent('115 × 10 s subs')
    expect(screen.queryByText(/not yet returned by any tool/)).not.toBeInTheDocument()
  })

  it('shows an honest absence when this poll carried no exposure', () => {
    const stack = StackStateSchema.parse({ stacked_frame: 3, dropped_frame: 0 })
    render(<TelemetryGrid stack={stack} tier1={null} focuser={null} stage="Stack" stageHistory={[]} />)
    const integration = cell('INTEGRATION')
    expect(integration).toHaveTextContent('—')
    expect(integration).toHaveTextContent(/exposure not reported/)
  })
})
