import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ProjectCard } from './ProjectCard'
import type { MergedProject } from './projects'
import type { Project } from '../../api/schemas'

const project = (overrides: Partial<Project> = {}): Project => ({
  target_id: 'M1',
  target_name: 'Crab Nebula',
  goal_minutes: 0,
  collected_minutes: 0,
  status: 'active',
  created_utc: '2026-07-12T06:00:00+00:00',
  updated_utc: '2026-07-12T06:00:00+00:00',
  sessions: [],
  notes: '',
  ...overrides,
})

const merged = (overrides: Partial<MergedProject> = {}): MergedProject => ({
  targetId: 'M1',
  targetName: 'Crab Nebula',
  totalMinutes: 60,
  storeMinutes: 60,
  archiveMinutes: 0,
  sources: ['store'],
  store: project(),
  ...overrides,
})

describe('ProjectCard', () => {
  it('renders the target id, common name, and hours collected', () => {
    render(<ProjectCard project={merged({ totalMinutes: 84.2 })} selected={false} onSelect={vi.fn()} />)
    expect(screen.getByText('M1')).toBeInTheDocument()
    expect(screen.getByText('Crab Nebula')).toBeInTheDocument()
    expect(screen.getByText('1.4 h')).toBeInTheDocument()
  })

  it('tags a store project with no goal as "no goal" and says so instead of a goal figure', () => {
    render(<ProjectCard project={merged({ store: project({ goal_minutes: 0 }) })} selected={false} onSelect={vi.fn()} />)
    expect(screen.getByText('no goal')).toBeInTheDocument()
    expect(screen.getByText('no goal set')).toBeInTheDocument()
  })

  it('tags an archive-only target distinctly and omits the goal figure entirely', () => {
    render(
      <ProjectCard
        project={merged({ store: null, sources: ['archive'], storeMinutes: 0, archiveMinutes: 217.2, totalMinutes: 217.2 })}
        selected={false}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText('archive only')).toBeInTheDocument()
    // "no goal set" would misleadingly imply this is a tracked, goal-less
    // project; an archive-only target isn't a project at all.
    expect(screen.queryByText('no goal set')).not.toBeInTheDocument()
    expect(screen.queryByText(/of .* goal/)).not.toBeInTheDocument()
  })

  it('shows an honest reason instead of session counts for an archive-only target', () => {
    render(<ProjectCard project={merged({ store: null })} selected={false} onSelect={vi.fn()} />)
    expect(screen.getByText(/archive only — no per-session detail/)).toBeInTheDocument()
  })

  it('renders no progress track while goal_minutes is 0 (every real project today)', () => {
    render(<ProjectCard project={merged({ store: project({ goal_minutes: 0 }) })} selected={false} onSelect={vi.fn()} />)
    expect(screen.queryByTestId('progress-track')).not.toBeInTheDocument()
  })

  it('renders no progress track for an archive-only target', () => {
    render(<ProjectCard project={merged({ store: null })} selected={false} onSelect={vi.fn()} />)
    expect(screen.queryByTestId('progress-track')).not.toBeInTheDocument()
  })

  it('renders a progress track at the right width once a goal exists (forward-compat path)', () => {
    render(
      <ProjectCard
        project={merged({ totalMinutes: 30, store: project({ goal_minutes: 60 }) })}
        selected={false}
        onSelect={vi.fn()}
      />,
    )
    const track = screen.getByTestId('progress-track')
    const fill = track.firstElementChild as HTMLElement
    expect(fill.style.width).toBe('50%')
    expect(screen.getByText('needs data')).toBeInTheDocument()
    expect(screen.getByText('of 1.0 h goal')).toBeInTheDocument()
  })

  it('shows the provenance split, not just the merged total', () => {
    render(
      <ProjectCard
        project={merged({ sources: ['store', 'archive'], storeMinutes: 84.2, archiveMinutes: 38.3, totalMinutes: 122.5 })}
        selected={false}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText('84.2 min store + 38.3 min archive')).toBeInTheDocument()
  })

  it('titles the meta line with the FWHM-absence reason when the underlying session has none', () => {
    render(
      <ProjectCard
        project={merged({
          store: project({
            sessions: [{ date_utc: '2026-07-12T06:00:00+00:00', integration_minutes: 20, subs_total: 100, subs_kept: 100, median_fwhm: null, notes: '' }],
          }),
        })}
        selected={false}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText(/med FWHM —/).title).toMatch(/median_fwhm is null/)
  })

  it('calls onSelect when clicked', () => {
    const onSelect = vi.fn()
    render(<ProjectCard project={merged()} selected={false} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('reflects the selected prop via aria-pressed', () => {
    const { rerender } = render(<ProjectCard project={merged()} selected={false} onSelect={vi.fn()} />)
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false')
    rerender(<ProjectCard project={merged()} selected onSelect={vi.fn()} />)
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true')
  })
})
