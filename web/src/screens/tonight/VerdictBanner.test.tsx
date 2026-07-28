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
    // Scoped by testid rather than getByText. The recorded night is 99.0%
    // cloud AND a 0.9877 moon that rounds to 99%, so a bare getByText('99%')
    // matches two elements and throws. Do not "fix" that collision by
    // truncating the moon to 98% — the display rounding is correct; it was the
    // query that was too loose.
    expect(screen.getByTestId('stat-cloud')).toHaveTextContent('99%')
    expect(screen.getByTestId('stat-moon')).toHaveTextContent('99%')
    expect(screen.getByTestId('stat-dew')).toHaveTextContent('high')
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

  it('does not blame the server for the MOON stat the UI itself suppressed', () => {
    // The server DID return moon_illum_frac (0.0, from its outage fallback) —
    // it is the UI choosing not to show it. The tooltip must not claim
    // otherwise, unlike PRECIP, which really was never returned.
    render(<VerdictBanner conditions={unknown} />)
    const moonTitle = screen.getByTestId('stat-moon').getAttribute('title')
    expect(moonTitle).not.toMatch(/not returned by assess_conditions/i)
    expect(moonTitle).toMatch(/suppressed by the ui/i)
  })

  it('gives CLOUD an outage-specific tooltip, distinct from PRECIP\'s never-returned one', () => {
    render(<VerdictBanner conditions={unknown} />)
    const cloudTitle = screen.getByTestId('stat-cloud').getAttribute('title')
    const precipTitle = screen.getByTestId('stat-precip').getAttribute('title')
    expect(cloudTitle).toMatch(/outage/i)
    expect(cloudTitle).not.toBe(precipTitle)
  })
})
