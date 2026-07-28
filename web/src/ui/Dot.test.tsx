import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Dot } from './Dot'

describe('Dot', () => {
  it('tags every tone with data-dot so tests can assert on dots', () => {
    const { rerender } = render(<Dot tone="pass" />)
    expect(screen.getByTestId('dot')).toHaveAttribute('data-dot', 'pass')
    rerender(<Dot tone="reject" />)
    expect(screen.getByTestId('dot')).toHaveAttribute('data-dot', 'reject')
  })

  it('supports the two sizes the design uses', () => {
    const { rerender } = render(<Dot tone="pass" />)
    const md = screen.getByTestId('dot').className
    rerender(<Dot tone="pass" size="sm" />)
    expect(screen.getByTestId('dot').className).not.toBe(md)
  })
})
