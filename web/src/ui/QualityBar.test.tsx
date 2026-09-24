import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { QualityBar } from './QualityBar'

const counts = (over: Partial<Record<string, number>> = {}) => ({
  pass: 10,
  marginal: 5,
  reject: 5,
  unknown: 0,
  total: 20,
  ...over,
})

const segments = (c: HTMLElement) =>
  [...c.querySelectorAll('span')].filter((s) => s.style.width.endsWith('%'))

describe('QualityBar', () => {
  it('splits the bar by the server’s verdict counts', () => {
    const { container } = render(<QualityBar verdicts={counts()} />)

    expect(segments(container).map((s) => s.style.width)).toEqual(['50%', '25%', '25%'])
  })

  it('omits a zero-count segment rather than drawing a sliver', () => {
    const { container } = render(
      <QualityBar verdicts={counts({ pass: 20, marginal: 0, reject: 0, total: 20 })} />,
    )

    expect(segments(container)).toHaveLength(1)
    expect(segments(container)[0]!.style.width).toBe('100%')
  })

  it('gives an unrecognised verdict its own visible slice', () => {
    // It is counted separately server-side so a vocabulary change shows up
    // rather than quietly inflating "pass". That has to survive to the bar.
    const { container } = render(
      <QualityBar
        verdicts={counts({ pass: 10, marginal: 0, reject: 0, unknown: 10, total: 20 })}
      />,
    )

    expect(segments(container)).toHaveLength(2)
    expect(segments(container).map((s) => s.style.width)).toEqual(['50%', '50%'])
  })

  it('says how many are keepable, counting marginal as kept', () => {
    // Matches the server's own keep decision: only REJECT is dropped, so a
    // caption that excluded MARGINAL would understate what survives.
    render(<QualityBar verdicts={counts()} />)

    expect(screen.getByText(/15 of 20 subs keepable/)).toBeInTheDocument()
    expect(screen.getByText(/5 rejected/)).toBeInTheDocument()
  })

  it('keeps everything the server did not REJECT — an unrecognised verdict included', () => {
    // The server's keep rule is `verdict != "REJECT"` (qa_tier2.py keep_list),
    // so a verdict outside the three is KEPT. pass + marginal would drop it
    // from the caption and understate what survives. The payload carries no
    // kept count here (verdict_counts has none), so it is total − reject.
    render(
      <QualityBar verdicts={counts({ pass: 10, marginal: 0, reject: 5, unknown: 5, total: 20 })} />,
    )

    expect(screen.getByText(/15 of 20 subs keepable/)).toBeInTheDocument()
  })

  it('renders nothing at all for an empty report', () => {
    // Distinct from "never analysed", which the CALLER handles by passing no
    // verdicts. Either way the card must not show an empty bar, which reads
    // as "nothing passed".
    const { container } = render(
      <QualityBar verdicts={{ pass: 0, marginal: 0, reject: 0, unknown: 0, total: 0 }} />,
    )

    expect(container).toBeEmptyDOMElement()
  })

  it('is a button only when there is somewhere to go', () => {
    const onOpen = vi.fn()
    const { rerender } = render(<QualityBar verdicts={counts()} onOpen={onOpen} />)

    fireEvent.click(screen.getByRole('button'))
    expect(onOpen).toHaveBeenCalledOnce()

    rerender(<QualityBar verdicts={counts()} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  describe('what the verdicts cover', () => {
    // The dashboard's Tier-2 runs on archive paths only. M1 on the real
    // install read "113 of 265 subs keepable" beside 3.5 h, but those 265
    // subs are the archive's 44.2 min: the store's 167.2 min were never
    // analysed, and 43% keepable read as applying to all 3.5 h.
    const m1 = counts({ pass: 60, marginal: 53, reject: 152, unknown: 0, total: 265 })

    it('says QA covers only the archive when the target has store time too', () => {
      render(<QualityBar verdicts={m1} coverage={{ storeMinutes: 167.2, archiveMinutes: 44.2 }} />)

      expect(screen.getByText(/113 of 265 subs keepable · 152 rejected/)).toBeInTheDocument()
      expect(screen.getByTestId('qa-coverage-note')).toHaveTextContent(
        "QA covers the archive's 44.2 min only; the store's 167.2 min is not analysed here",
      )
    })

    it('keeps the note inside the report button, so it travels with the caption', () => {
      render(<QualityBar verdicts={m1} coverage={{ storeMinutes: 167.2, archiveMinutes: 44.2 }} onOpen={vi.fn()} />)

      expect(screen.getByRole('button')).toContainElement(screen.getByTestId('qa-coverage-note'))
    })

    it.each([
      ['the archive is all the target has', { storeMinutes: 0, archiveMinutes: 44.2 }],
      ['the caller says nothing about coverage', undefined],
    ])('adds no note when %s', (_label, coverage) => {
      render(<QualityBar verdicts={m1} coverage={coverage} />)

      expect(screen.queryByTestId('qa-coverage-note')).not.toBeInTheDocument()
    })
  })
})
