import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { Tier2Schema, type QaTarget } from '../../api/schemas'
import { MobileReviewView } from './MobileReviewView'
import { makeSub } from './testReasons'

const summary = Tier2Schema.parse(
  JSON.parse(readFileSync(resolve(__dirname, '../../../../fixtures/qa_tier2.subs.json'), 'utf-8')),
).summary

const targets = [
  { target_id: 'M81', display_name: 'M 81', sub_count: 587, status: 'complete' },
  { target_id: 'M42', display_name: 'M 42', sub_count: 1204, status: 'not_analysed' },
] as unknown as QaTarget[]

const view = (over: Partial<Parameters<typeof MobileReviewView>[0]> = {}) =>
  render(
    <MobileReviewView
      targets={targets}
      selected="M81"
      onSelect={vi.fn()}
      summary={summary}
      displayName="M 81"
      state={<p>nothing yet</p>}
      {...over}
    />,
  )

/**
 * Mobile Review & QA — an extension beyond the design handoff, which covered
 * phone frames for Tonight and Live only. These pin the departures that were
 * deliberate, so a later reader can tell them from omissions.
 */
describe('MobileReviewView', () => {
  it('collapses the target list into one native control', () => {
    // A 300px picker column IS the desktop layout; stacked on a phone it
    // would be twenty-two rows before the report.
    view()

    const select = screen.getByRole('combobox')
    expect(select).toHaveValue('M81')
    expect(screen.getByRole('option', { name: /M 42 · 1204 subs/ })).toBeInTheDocument()
  })

  it('reports which targets are already analysed in the picker itself', () => {
    view()

    expect(screen.getByRole('option', { name: /M 81 · 587 subs · analysed/ })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /M 42 · 1204 subs$/ })).toBeInTheDocument()
  })

  it('selects through the control', () => {
    const onSelect = vi.fn()
    view({ onSelect })

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'M42' } })

    expect(onSelect).toHaveBeenCalledWith('M42')
  })

  it('keeps every reason verbatim — the phone is not a reason to drop the audit trail', () => {
    view()

    const rejected = summary.subs.find((s) => s.verdict === 'REJECT')!
    expect(screen.getByText(rejected.reasons.join(' · '))).toBeInTheDocument()
  })

  it('renders the caller’s state node when there is no report', () => {
    // The screen owns that copy and the Analyse button; this view must not
    // re-derive either.
    view({ summary: null, state: <p>No analysis yet for this target.</p> })

    expect(screen.getByText('No analysis yet for this target.')).toBeInTheDocument()
    expect(screen.queryByText(/subs keepable|KEPT/)).not.toBeInTheDocument()
  })

  it('shows one chart, not two', () => {
    // Star count exists on desktop to be read AGAINST eccentricity on a
    // shared x-scale. Two stacked 44px charts on a phone invite exactly the
    // comparison this width makes unreliable.
    view()

    expect(screen.getByText('Per-sub eccentricity')).toBeInTheDocument()
    expect(screen.queryByText(/Star count/)).not.toBeInTheDocument()
  })

  it('caps the rows and says it capped them', () => {
    view()

    expect(screen.getByText(/showing 6 of 25/)).toBeInTheDocument()
  })
})

describe('MobileReviewView — a sub with no reasons', () => {
  it('says "clears every gate" only for a PASS', () => {
    view({
      summary: {
        ...summary,
        subs: [
          makeSub('p', 'PASS', [], { eccentricity: 0.4 }),
          makeSub('r', 'REJECT', [], { eccentricity: 0.4 }),
        ],
      },
    })

    expect(screen.getAllByText(/clears every gate/i)).toHaveLength(1)
    expect(screen.getByText(/no reason given/i)).toBeInTheDocument()
  })
})
