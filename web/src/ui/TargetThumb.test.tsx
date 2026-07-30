import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TargetThumb } from './TargetThumb'
import type { TargetImage } from '../api/schemas'

const own: TargetImage = { url: '/api/target_image/M31', source: 'own', credit: null }
const survey: TargetImage = {
  url: '/api/target_image/IC405',
  source: 'survey',
  credit: 'DSS2 · STScI',
}

describe('TargetThumb', () => {
  it('renders the own capture as a plain image with no survey marker', () => {
    const { container } = render(<TargetThumb image={own} alt="M31" className="box" />)
    const img = screen.getByRole('img', { name: 'M31' })
    expect(img).toHaveAttribute('src', '/api/target_image/M31')
    expect(screen.queryByTestId('survey-badge')).not.toBeInTheDocument()
    expect(container.querySelector('[data-testid="thumb-empty"]')).toBeNull()
  })

  it('renders a survey image with a visible marker and the credit reachable on hover', () => {
    render(<TargetThumb image={survey} alt="IC 405" className="box" />)
    const img = screen.getByRole('img', { name: 'IC 405' })
    expect(img).toHaveAttribute('src', '/api/target_image/IC405')
    const badge = screen.getByTestId('survey-badge')
    expect(badge).toHaveTextContent('SURVEY')
    expect(badge).toHaveAttribute('title', 'DSS2 · STScI')
  })

  it('falls back to a generic title when a survey image carries no credit', () => {
    render(<TargetThumb image={{ ...survey, credit: null }} alt="IC 405" className="box" />)
    expect(screen.getByTestId('survey-badge')).toHaveAttribute('title', 'Sky survey imagery')
  })

  it('renders the empty placeholder, not a broken-image glyph, when image is null', () => {
    render(<TargetThumb image={null} alt="M13" className="box" />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByTestId('thumb-empty')).toBeInTheDocument()
    expect(screen.queryByTestId('survey-badge')).not.toBeInTheDocument()
  })

  it('treats a missing image field (undefined) the same as null', () => {
    render(<TargetThumb image={undefined} alt="M13" className="box" />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByTestId('thumb-empty')).toBeInTheDocument()
  })

  it('degrades to the empty placeholder, not a broken glyph, when the image fails to load', () => {
    render(<TargetThumb image={survey} alt="IC 405" className="box" />)
    const img = screen.getByRole('img', { name: 'IC 405' })
    fireEvent.error(img)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByTestId('thumb-empty')).toBeInTheDocument()
    // The survey marker is part of the image state, not the placeholder's —
    // a failed load must not leave a stray "SURVEY" badge over a blank box.
    expect(screen.queryByTestId('survey-badge')).not.toBeInTheDocument()
  })

  it('keeps the caller-supplied sizing class on the outer box in every state, so the box never resizes as data arrives', () => {
    const states: (TargetImage | null | undefined)[] = [own, survey, null, undefined]
    for (const image of states) {
      const { container, unmount } = render(<TargetThumb image={image} alt="x" className="box" />)
      expect(container.firstElementChild).toHaveClass('box')
      unmount()
    }
  })
})
