import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { VerdictBanner } from './VerdictBanner'
import { ConditionsSchema } from '../../api/schemas'
import { goConditions, recordedConditions, unknownConditions } from '../../test/fixtures'

const recorded = ConditionsSchema.parse(recordedConditions())
const go = ConditionsSchema.parse(goConditions())
const unknown = ConditionsSchema.parse(unknownConditions())

describe('VerdictBanner', () => {
  it('renders the real recorded night as NO-GO', () => {
    render(<VerdictBanner conditions={recorded} />)
    expect(screen.getByText('NO-GO')).toBeInTheDocument()
  })

  it('lists every server reason on a NO-GO', () => {
    render(<VerdictBanner conditions={recorded} />)
    for (const reason of recorded.reasons) {
      expect(screen.getByText(reason)).toBeInTheDocument()
    }
  })

  it('renders GO and UNKNOWN from their fixtures', () => {
    const { unmount } = render(<VerdictBanner conditions={go} />)
    expect(screen.getByText('GO')).toBeInTheDocument()
    unmount()
    render(<VerdictBanner conditions={unknown} />)
    expect(screen.getByText('UNKNOWN')).toBeInTheDocument()
  })

  it('shows cloud, moon and dew from real fields', () => {
    render(<VerdictBanner conditions={recorded} />)
    expect(screen.getByText('99%')).toBeInTheDocument()   // cloud_cover_pct
    expect(screen.getByText('98%')).toBeInTheDocument()   // moon_illum_frac
    expect(screen.getByText('high')).toBeInTheDocument()  // dew_risk
  })

  it('shows precipitation as absent, never a fabricated number', () => {
    render(<VerdictBanner conditions={recorded} />)
    const precip = screen.getByTestId('stat-precip')
    expect(precip).toHaveTextContent('—')
    expect(precip).not.toHaveTextContent('%')
  })

  it('renders null-valued stats as em-dashes on the UNKNOWN fixture', () => {
    render(<VerdictBanner conditions={unknown} />)
    expect(screen.getByTestId('stat-cloud')).toHaveTextContent('—')
  })

  it('never shows MOON 0% on a weather outage', () => {
    // _unknown() zeroes moon_illum_frac rather than nulling it, so a naive
    // render reports a 0% moon that was never measured.
    render(<VerdictBanner conditions={unknown} />)
    const moon = screen.getByTestId('stat-moon')
    expect(moon).toHaveTextContent('—')
    expect(moon).not.toHaveTextContent('0%')
  })

  it('shows the honest "unknown" dew string rather than blanking it', () => {
    render(<VerdictBanner conditions={unknown} />)
    expect(screen.getByTestId('stat-dew')).toHaveTextContent('unknown')
  })
})
