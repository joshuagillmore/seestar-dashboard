import { render, screen, within } from '@testing-library/react'
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

  it('renders GO and UNKNOWN from their fixtures', () => {
    const { unmount } = render(<VerdictBanner conditions={go} />)
    expect(screen.getByText('GO')).toBeInTheDocument()
    unmount()
    render(<VerdictBanner conditions={unknown} />)
    expect(screen.getByText('UNKNOWN')).toBeInTheDocument()
  })

  describe('the headline slot', () => {
    it('renders nothing today — no fixture carries a summary yet, and none of them ship one', () => {
      // Guards against ever inventing/composing a headline client-side: if
      // this ever starts failing because a fixture gained `summary`, the fix
      // is to update the fixture-based expectations below, not to make the
      // component compose a sentence from reasons[].
      expect(recorded.summary).toBeUndefined()
      const { container } = render(<VerdictBanner conditions={recorded} />)
      expect(container.querySelector('p')).toBeNull()
    })

    it('renders the server summary verbatim as the headline when the field is present', () => {
      const withSummary = { ...recorded, summary: 'Heavy cloud (85%) rules out tonight.' }
      render(<VerdictBanner conditions={withSummary} />)
      expect(screen.getByText('Heavy cloud (85%) rules out tonight.')).toBeInTheDocument()
    })

    it('renders nothing, not an empty element, when summary is explicitly null', () => {
      const nullSummary = { ...recorded, summary: null }
      const { container } = render(<VerdictBanner conditions={nullSummary} />)
      expect(container.querySelector('p')).toBeNull()
    })
  })

  describe('the reasons list', () => {
    it('lists every server reason when there is no headline (today)', () => {
      render(<VerdictBanner conditions={recorded} />)
      for (const reason of recorded.reasons) {
        expect(screen.getByText(reason)).toBeInTheDocument()
      }
    })

    it('collapses entirely once a headline exists — the reasons are not repeated under it', () => {
      const withSummary = { ...recorded, summary: 'Heavy cloud (85%) rules out tonight.' }
      render(<VerdictBanner conditions={withSummary} />)
      for (const reason of recorded.reasons) {
        expect(screen.queryByText(reason)).not.toBeInTheDocument()
      }
    })
  })

  describe('the fact row', () => {
    it('shows cloud, dew, wind and moon from the real structured fields, each with its label', () => {
      render(<VerdictBanner conditions={recorded} />)
      expect(screen.getByTestId('fact-cloud')).toHaveTextContent('cloud 85%')
      expect(screen.getByTestId('fact-dew')).toHaveTextContent('dew high')
      expect(screen.getByTestId('fact-wind')).toHaveTextContent('wind 7 kph')
      expect(screen.getByTestId('fact-moon')).toHaveTextContent('moon 100% lit')
    })

    it('never renders a PRECIP fact — the server does not return the field, see handback item 3', () => {
      // Precip prose legitimately still appears inside the reasons[] list
      // below the fact row (it's the only place the figure exists at all
      // today) — this only guards the fact row itself against a tile.
      render(<VerdictBanner conditions={recorded} />)
      expect(screen.queryByTestId('fact-precip')).not.toBeInTheDocument()
      expect(within(screen.getByTestId('fact-row')).queryByText(/precip/i)).not.toBeInTheDocument()
    })

    it('drops the cloud, wind and moon facts cleanly on a weather outage, rather than a placeholder or "null"', () => {
      const { container } = render(<VerdictBanner conditions={unknown} />)
      expect(screen.queryByTestId('fact-cloud')).not.toBeInTheDocument()
      expect(screen.queryByTestId('fact-wind')).not.toBeInTheDocument()
      expect(screen.queryByTestId('fact-moon')).not.toBeInTheDocument()
      expect(container.textContent).not.toMatch(/null/i)
      // dew_risk is never null (the outage fallback is the honest string
      // "unknown"), so unlike the other three it still renders.
      expect(screen.getByTestId('fact-dew')).toHaveTextContent('dew unknown')
    })

    it('never shows a fabricated MOON 0% on a weather outage', () => {
      // _unknown() zeroes moon_illum_frac rather than nulling it, so a naive
      // render would report a 0% moon that was never measured.
      render(<VerdictBanner conditions={unknown} />)
      expect(screen.queryByText(/moon 0%/)).not.toBeInTheDocument()
    })

    describe('dew tone', () => {
      it('gives a high dew risk the reject tone', () => {
        expect(recorded.dew_risk).toBe('high')
        render(<VerdictBanner conditions={recorded} />)
        expect(screen.getByTestId('fact-dew')).toHaveAttribute('data-tone', 'reject')
      })

      it('gives a moderate dew risk the marginal tone', () => {
        const moderate = { ...go, dew_risk: 'moderate' }
        render(<VerdictBanner conditions={moderate} />)
        expect(screen.getByTestId('fact-dew')).toHaveAttribute('data-tone', 'marginal')
      })

      it('gives a low dew risk the pass tone', () => {
        expect(go.dew_risk).toBe('low')
        render(<VerdictBanner conditions={go} />)
        expect(screen.getByTestId('fact-dew')).toHaveAttribute('data-tone', 'pass')
      })

      it('renders "unknown" dew risk with no tone rather than guessing one', () => {
        expect(unknown.dew_risk).toBe('unknown')
        render(<VerdictBanner conditions={unknown} />)
        expect(screen.getByTestId('fact-dew')).not.toHaveAttribute('data-tone')
      })
    })
  })

  describe('the GPS row', () => {
    it('shows the real GPS warning verbatim, in the marginal tone, when the site is unverified', () => {
      render(<VerdictBanner conditions={recorded} />)
      const warning = recorded.location.warning
      if (!warning) throw new Error('recorded fixture must carry a GPS warning for this test to mean anything')
      expect(screen.getByText(warning)).toBeInTheDocument()
      expect(screen.getAllByTestId('dot').find((d) => d.getAttribute('data-dot') === 'marginal')).toBeTruthy()
    })

    it('shows a confirmed pass-toned row when there is no warning', () => {
      const confirmed = { ...recorded, location: { ...recorded.location, warning: null } }
      render(<VerdictBanner conditions={confirmed} />)
      expect(screen.getByText('GPS matched')).toBeInTheDocument()
      expect(screen.getAllByTestId('dot').find((d) => d.getAttribute('data-dot') === 'pass')).toBeTruthy()
    })
  })
})
