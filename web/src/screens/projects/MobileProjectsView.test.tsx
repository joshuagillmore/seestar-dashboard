import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { QaTargets } from '../../api/schemas'
import { MobileProjectsView } from './MobileProjectsView'
import type { MergedProject } from './projects'

const project = (over: Partial<MergedProject> = {}): MergedProject =>
  ({
    targetId: 'M81',
    targetName: 'M 81',
    totalMinutes: 96,
    storeMinutes: 0,
    archiveMinutes: 96,
    sources: ['archive'],
    store: null,
    goal: null,
    image: null,
    nights: [],
    ...over,
  }) as MergedProject

const qa = {
  ok: true,
  archive_status: { configured: true, path: '/a', exists: true, target_count: 1 },
  targets: [
    {
      target_id: 'M81',
      display_name: 'M 81',
      sub_count: 587,
      status: 'complete',
      verdicts: { pass: 300, marginal: 177, reject: 110, unknown: 0, total: 587 },
    },
  ],
} as unknown as QaTargets

describe('MobileProjectsView', () => {
  it('gives each project one row with its hours', () => {
    render(
      <MobileProjectsView projects={[project()]} headline="1 project" qa={null} onOpenQa={vi.fn()} />,
    )

    expect(screen.getByText('M81')).toBeInTheDocument()
    expect(screen.getByText('1.6 h')).toBeInTheDocument()
  })

  it('keeps the quality bar, which is the reason to scroll this list', () => {
    render(
      <MobileProjectsView projects={[project()]} headline="1 project" qa={qa} onOpenQa={vi.fn()} />,
    )

    expect(screen.getByTestId('quality-bar')).toBeInTheDocument()
    expect(screen.getByText(/477 of 587 subs keepable/)).toBeInTheDocument()
  })

  it('opens that target’s report — the same handoff the desktop card offers', () => {
    const onOpenQa = vi.fn()
    render(
      <MobileProjectsView projects={[project()]} headline="1 project" qa={qa} onOpenQa={onOpenQa} />,
    )

    fireEvent.click(screen.getByRole('button', { name: /keepable/ }))

    expect(onOpenQa).toHaveBeenCalledWith('M81')
  })

  it('renders no quality bar for an unanalysed target', () => {
    // Absent, not an empty bar — an empty bar reads as "nothing passed".
    render(
      <MobileProjectsView
        projects={[project({ targetId: 'M42' })]}
        headline="1 project"
        qa={qa}
        onOpenQa={vi.fn()}
      />,
    )

    expect(screen.queryByTestId('quality-bar')).not.toBeInTheDocument()
  })

  it('drops the thumbnail deliberately', () => {
    // 33 images at 90px is most of the payload, for decoration identifying a
    // target the name already names.
    const { container } = render(
      <MobileProjectsView projects={[project()]} headline="1 project" qa={qa} onOpenQa={vi.fn()} />,
    )

    expect(container.querySelector('img')).toBeNull()
  })
})
