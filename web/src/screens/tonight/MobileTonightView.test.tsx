import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ConditionsSchema, PlanTargetsSchema, SiteProfileSchema } from '../../api/schemas'
import { goConditions, recordedConditions, recordedPlan, recordedSite } from '../../test/fixtures'
import { MobileTonightView } from './MobileTonightView'
import { shortlistOrderLabel } from './shortlist'
import { localHhMm, parse } from './timeline'

const recorded = ConditionsSchema.parse(recordedConditions())
const plan = PlanTargetsSchema.parse(recordedPlan())
const site = SiteProfileSchema.parse(recordedSite())

describe('MobileTonightView', () => {
  it('renders the real verdict word from conditions.go, not the design mockup\'s illustrative "GO"', () => {
    render(<MobileTonightView conditions={recorded} targets={plan.targets} site={site} />)
    // The recorded fixture is a NO-GO night — asserting the actual computed
    // word, not merely that some verdict rendered, is what would catch a
    // hardcoded "GO" copied verbatim from the design mockup.
    expect(screen.getByText('NO-GO')).toBeInTheDocument()
    expect(screen.queryByText('GO')).not.toBeInTheDocument()
  })

  it('renders GO on a go night', () => {
    const go = ConditionsSchema.parse(goConditions())
    render(<MobileTonightView conditions={go} targets={plan.targets} site={site} />)
    expect(screen.getByText('GO')).toBeInTheDocument()
  })

  it('shows the real site name in the eyebrow, not the design mockup\'s illustrative "Backyard"', () => {
    render(<MobileTonightView conditions={recorded} targets={plan.targets} site={site} />)
    // site.profile.name ("Example Observatory (scope GPS)") contains regex metacharacters
    // — escape before building the matcher rather than matching a substring
    // that happens to ignore them.
    const escaped = site.profile.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    expect(screen.getByText(new RegExp(escaped))).toBeInTheDocument()
    expect(screen.queryByText(/Backyard/)).not.toBeInTheDocument()
  })

  it('renders the DEW RISK tile from the real recorded value, not the design mockup\'s illustrative "low"', () => {
    render(<MobileTonightView conditions={recorded} targets={plan.targets} site={site} />)
    // Recorded fixture's dew_risk is "high" (see assess_conditions.json) —
    // proof the tile reads the real field rather than always showing the
    // design's example value.
    expect(recorded.dew_risk).toBe('high')
    expect(screen.getByText('high')).toBeInTheDocument()
  })

  it('renders the DARK WINDOW tile from the real dark_window_utc pair', () => {
    render(<MobileTonightView conditions={recorded} targets={plan.targets} site={site} />)
    const [from, to] = recorded.dark_window_utc
    expect(
      screen.getByText(`${localHhMm(parse(from))} → ${localHhMm(parse(to))}`),
    ).toBeInTheDocument()
  })

  it('renders conditions.summary verbatim when the server sends one', () => {
    const withSummary = ConditionsSchema.parse({ ...recorded, summary: 'a real server sentence' })
    render(<MobileTonightView conditions={withSummary} targets={plan.targets} site={site} />)
    expect(screen.getByText('a real server sentence')).toBeInTheDocument()
  })

  it('does not compose its own sentence from cloud/dew/moon figures when summary is absent — the recorded fixture has no summary', () => {
    expect(recorded.summary ?? null).toBeNull()
    render(<MobileTonightView conditions={recorded} targets={plan.targets} site={site} />)
    // None of the reasons[] prose (which a composed sentence might have been
    // built from) appears verbatim next to the verdict — the only honest
    // content next to it is the verdict word itself.
    for (const reason of recorded.reasons) {
      expect(screen.queryByText(reason)).not.toBeInTheDocument()
    }
  })

  it('caps the shortlist at 3 rows even though the fixture carries 12 targets', () => {
    expect(plan.targets.length).toBeGreaterThan(3)
    render(<MobileTonightView conditions={recorded} targets={plan.targets} site={site} />)
    expect(screen.getAllByTestId('mobile-shortlist-row')).toHaveLength(3)
  })

  it('renders the top 3 targets in the plan\'s own order, with their real scores', () => {
    render(<MobileTonightView conditions={recorded} targets={plan.targets} site={site} />)
    const rows = screen.getAllByTestId('mobile-shortlist-row')
    plan.targets.slice(0, 3).forEach((target, i) => {
      expect(rows[i]).toHaveTextContent(target.name)
      expect(rows[i]).toHaveTextContent(String(target.score))
      expect(rows[i]).toHaveTextContent(String(target.recommended_subs))
    })
  })

  it('renders an honest empty state, not a blank hole, when the ranker returns no targets', () => {
    render(<MobileTonightView conditions={recorded} targets={[]} site={site} />)
    expect(screen.queryByTestId('mobile-shortlist')).not.toBeInTheDocument()
    expect(screen.getByText(/No target clears the sweet band/)).toBeInTheDocument()
  })

  it('marks a survey-sourced thumbnail on a shortlist row, the same honesty guarantee TargetThumb enforces everywhere else', () => {
    const withImage = {
      ...plan.targets[0],
      image: { url: 'https://example.test/survey.jpg', source: 'survey' as const, credit: 'DSS2' },
    }
    render(<MobileTonightView conditions={recorded} targets={[withImage, ...plan.targets.slice(1)]} site={site} />)
    expect(screen.getByTestId('survey-badge')).toBeInTheDocument()
  })

  it('never shows the design mockup\'s excluded-target clause — it needs data no tool returns (handback item 4)', () => {
    const go = ConditionsSchema.parse(goConditions())
    render(<MobileTonightView conditions={go} targets={plan.targets} site={site} />)
    expect(screen.queryByText(/dropped — behind horizon mask/)).not.toBeInTheDocument()
  })

  it('reinstates the real order clause on a GO night, shared verbatim with desktop via shortlistOrderLabel', () => {
    const go = ConditionsSchema.parse(goConditions())
    render(<MobileTonightView conditions={go} targets={plan.targets} site={site} />)
    // Built from the FULL targets array, not just the 3 rows shown — the
    // slew count and "+N more" folding both depend on the whole plan.
    expect(screen.getByText(shortlistOrderLabel(plan.targets))).toBeInTheDocument()
    expect(screen.queryByText(/ranked for reference/i)).not.toBeInTheDocument()
  })

  it('replaces the order clause with the no-go caption on the recorded NO-GO night — the two never both show', () => {
    render(<MobileTonightView conditions={recorded} targets={plan.targets} site={site} />)
    expect(screen.getByText(/ranked for reference — tonight is a no-go/i)).toBeInTheDocument()
    expect(screen.queryByText(shortlistOrderLabel(plan.targets))).not.toBeInTheDocument()
    expect(screen.queryByText(/^Order:/)).not.toBeInTheDocument()
  })

  it('renders no footer line at all when there is no shortlist to caption', () => {
    render(<MobileTonightView conditions={recorded} targets={[]} site={site} />)
    expect(screen.queryByText(/^Order:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/ranked for reference/i)).not.toBeInTheDocument()
  })

  it('renders normally with no site profile — a null prop must not crash the eyebrow', () => {
    render(<MobileTonightView conditions={recorded} targets={plan.targets} site={null} />)
    expect(screen.queryByText(/Backyard/)).not.toBeInTheDocument()
  })

  // Regression guard for the design's own hard requirement (README.md:723-724):
  // shortlist rows carry an explicit min-height of 44px. jsdom does not
  // compute real CSS layout (see LiveScreen.test.tsx's matching
  // minmax(0,1fr) guard for the same reason), so this reads the actual rule
  // from the CSS module source rather than measuring a rendered element.
  it('gives every shortlist row an explicit min-height of 44px — cold hands in the dark', () => {
    const css = readFileSync(join(__dirname, 'MobileTonightView.module.css'), 'utf8')
    const rowRule = css.match(/\.row\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rowRule).toMatch(/min-height:\s*44px/)
  })
})
