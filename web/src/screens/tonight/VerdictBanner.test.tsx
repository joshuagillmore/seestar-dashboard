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
    // Scoped by testid rather than getByText. Cloud and moon are two
    // independently-recorded percentages that can coincide by chance (they
    // did the night this fixture was first recorded: both 99%) — a bare
    // getByText would match two elements and throw whenever a re-record
    // happens to line them up again.
    expect(screen.getByTestId('stat-cloud')).toHaveTextContent('85%')
    expect(screen.getByTestId('stat-moon')).toHaveTextContent('100%')
    expect(screen.getByTestId('stat-dew')).toHaveTextContent('high')
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

  it('gives CLOUD an outage-specific tooltip, distinct from MOON\'s UI-suppressed one', () => {
    render(<VerdictBanner conditions={unknown} />)
    const cloudTitle = screen.getByTestId('stat-cloud').getAttribute('title')
    const moonTitle = screen.getByTestId('stat-moon').getAttribute('title')
    expect(cloudTitle).toMatch(/outage/i)
    expect(cloudTitle).not.toBe(moonTitle)
  })

  it('does not render a PRECIP tile — the server never returns the field, see handback item 3', () => {
    render(<VerdictBanner conditions={recorded} />)
    expect(screen.queryByTestId('stat-precip')).not.toBeInTheDocument()
  })

  describe('dew risk tone', () => {
    // _dew_risk is a closed four-value categorical (high/moderate/low/unknown)
    // and the mapping to a tone is a 1:1 relabel, not threshold arithmetic —
    // the cutoffs (spread < 2 deg C, < 5 deg C) stay server-side. data-tone
    // mirrors Dot's data-dot: the CSS Modules class name is a hashed
    // implementation detail, not something a test should compare against.
    it('gives a high dew risk the reject tone', () => {
      // The recorded fixture is tonight's real -0.0 deg C spread — air at its
      // dewpoint, optics will fog — so this is the actual worst case, not a
      // constructed one.
      expect(recorded.dew_risk).toBe('high')
      render(<VerdictBanner conditions={recorded} />)
      expect(screen.getByTestId('stat-dew')).toHaveAttribute('data-tone', 'reject')
    })

    it('gives a moderate dew risk the marginal tone', () => {
      // No recorded or synthetic fixture currently has a moderate reading, so
      // this constructs one from the GO fixture — everything else about it is
      // irrelevant to this assertion, only dew_risk is overridden.
      const moderate = { ...go, dew_risk: 'moderate' }
      render(<VerdictBanner conditions={moderate} />)
      expect(screen.getByTestId('stat-dew')).toHaveAttribute('data-tone', 'marginal')
    })

    it('gives a low dew risk the pass tone', () => {
      expect(go.dew_risk).toBe('low')
      render(<VerdictBanner conditions={go} />)
      expect(screen.getByTestId('stat-dew')).toHaveAttribute('data-tone', 'pass')
    })

    it('renders "unknown" dew risk with no tone rather than guessing one', () => {
      expect(unknown.dew_risk).toBe('unknown')
      render(<VerdictBanner conditions={unknown} />)
      expect(screen.getByTestId('stat-dew')).not.toHaveAttribute('data-tone')
    })
  })
})
