import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { QaTargetsSchema } from '../../api/schemas'
import { TargetPicker } from './TargetPicker'

const targets = QaTargetsSchema.parse({
  ok: true,
  archive_status: { configured: true, path: '/archive', exists: true, target_count: 4 },
  targets: [
    { target_id: 'A', display_name: 'A', sub_count: 40, status: 'complete', analysed_at: null },
    { target_id: 'B', display_name: 'B', sub_count: 30, status: 'stale', analysed_at: null },
    { target_id: 'C', display_name: 'C', sub_count: 20, status: 'failed', error: 'boom' },
    { target_id: 'D', display_name: 'D', sub_count: 10, status: 'not_analysed' },
  ],
})

/**
 * These are JOB states, on the one screen whose vocabulary is PASS /
 * MARGINAL / REJECT. Painting "stale" amber and "failed" red borrowed the
 * verdict colours for something that says nothing about sub quality — the
 * same mistake the file's own comment records fixing for "complete".
 */
describe('TargetPicker job-state styling', () => {
  it('never tones a job state in a verdict colour', () => {
    render(<TargetPicker targets={targets} selected={null} onSelect={vi.fn()} />)

    for (const text of ['analysed', 'stale', 'failed', 'not analysed']) {
      const status = screen.getByText(text, { selector: 'span' })
      expect(status.className).not.toMatch(/pass|marginal|reject/)
    }
  })

  it('still says which state each row is in, in words', () => {
    render(<TargetPicker targets={targets} selected={null} onSelect={vi.fn()} />)

    expect(screen.getByRole('button', { name: /^B/ })).toHaveTextContent('stale')
    expect(screen.getByRole('button', { name: /^C/ })).toHaveTextContent('failed')
  })
})
