import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectCard } from './ProjectCard'
import { mergeProjects, type MergedProject } from './projects'
import { ListProjectsSchema, ProjectsCombinedSchema, type IntegrationGoal, type Project } from '../../api/schemas'
import { recordedListProjects, recordedProjectsCombined } from '../../test/fixtures'

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

/** A normal (not coarse, not beyond-reach) numeric goal. Override individual
 * fields to reach the other three states. */
const goal = (overrides: Partial<IntegrationGoal> = {}): IntegrationGoal => ({
  track: 'photometric',
  suggested_hours: 3.0,
  coarse: false,
  beyond_reach: false,
  surface_brightness: 23.3,
  bortle_multiplier: 1.0,
  reason: null,
  note: "SB 23.30 mag/arcsec² → suggested 3.0 h — an empirical fit to amateur practice at the 'solid/presentable' tier, not a physical requirement.",
  ...overrides,
})

const IC405_GOAL: IntegrationGoal = {
  track: 'none',
  suggested_hours: null,
  coarse: false,
  beyond_reach: false,
  surface_brightness: 27.12,
  bortle_multiplier: 1.0,
  reason: 'photometry_unreliable',
  note:
    'SB 27.12 mag/arcsec² computes to ~158 h, which is not credible for this object class — ' +
    'treating the catalogued magnitude as unreliable, not the target as unreachable.',
}

const merged = (overrides: Partial<MergedProject> = {}): MergedProject => ({
  targetId: 'M1',
  targetName: 'Crab Nebula',
  totalMinutes: 60,
  storeMinutes: 60,
  archiveMinutes: 0,
  sources: ['store'],
  store: project(),
  goal: null,
  image: null,
  nights: [],
  ...overrides,
})

// Every test starts with a clean slate — several tests reuse target id 'M1',
// and the doubling toggle's state is real localStorage (see doubling.ts),
// not a mock, so a flag left set by one test would otherwise leak into the
// next.
beforeEach(() => localStorage.clear())

const realProjects = () =>
  mergeProjects(
    ProjectsCombinedSchema.parse(recordedProjectsCombined()).projects,
    ListProjectsSchema.parse(recordedListProjects()).projects,
  )

const findReal = (targetId: string): MergedProject => {
  const found = realProjects().find((p) => p.targetId === targetId)
  if (!found) throw new Error(`fixture no longer has ${targetId} — pick another real example`)
  return found
}

describe('ProjectCard', () => {
  it('renders the target id, common name, and hours collected', () => {
    render(<ProjectCard project={merged({ totalMinutes: 84.2 })} selected={false} onSelect={vi.fn()} />)
    expect(screen.getByText('M1')).toBeInTheDocument()
    expect(screen.getByText('Crab Nebula')).toBeInTheDocument()
    expect(screen.getByText('1.4 h')).toBeInTheDocument()
  })

  describe('the cover image (own / survey / absent — the three states TargetThumb renders)', () => {
    it('renders the own capture with no survey marker', () => {
      const image = { url: '/api/target_image/M1', source: 'own' as const, credit: null }
      render(<ProjectCard project={merged({ image })} selected={false} onSelect={vi.fn()} />)
      expect(screen.getByRole('img', { name: 'Crab Nebula' })).toHaveAttribute('src', '/api/target_image/M1')
      expect(screen.queryByTestId('survey-badge')).not.toBeInTheDocument()
    })

    it('renders a survey image with the SURVEY marker and the credit reachable on hover', () => {
      const image = { url: '/api/target_image/M1', source: 'survey' as const, credit: 'DSS2 · STScI' }
      render(<ProjectCard project={merged({ image })} selected={false} onSelect={vi.fn()} />)
      expect(screen.getByRole('img', { name: 'Crab Nebula' })).toBeInTheDocument()
      const badge = screen.getByTestId('survey-badge')
      expect(badge).toHaveTextContent('SURVEY')
      expect(badge).toHaveAttribute('title', 'DSS2 · STScI')
    })

    it('renders the empty placeholder, not a broken image, when the target has no image', () => {
      render(<ProjectCard project={merged({ image: null })} selected={false} onSelect={vi.fn()} />)
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
      expect(screen.getByTestId('thumb-empty')).toBeInTheDocument()
    })

    it('falls back to the same empty placeholder when the image fails to load', () => {
      const image = { url: '/api/target_image/M1', source: 'own' as const, credit: null }
      render(<ProjectCard project={merged({ image })} selected={false} onSelect={vi.fn()} />)
      fireEvent.error(screen.getByRole('img', { name: 'Crab Nebula' }))
      expect(screen.queryByRole('img')).not.toBeInTheDocument()
      expect(screen.getByTestId('thumb-empty')).toBeInTheDocument()
    })
  })

  describe('the four honest states for a target with no numeric goal to show', () => {
    it('a target with no catalogue record at all: "not in DSO catalogue", empty rail, no doubling toggle', () => {
      render(<ProjectCard project={merged({ goal: null })} selected={false} onSelect={vi.fn()} />)
      expect(screen.getByText('no goal')).toBeInTheDocument()
      expect(screen.getByText('not in DSO catalogue')).toBeInTheDocument()
      expect(screen.getByTestId('progress-track').firstElementChild).toBeNull()
      expect(screen.queryByRole('button', { name: /Double/ })).not.toBeInTheDocument()
    })

    it('no catalogued magnitude: distinct wording from "not catalogued", same neutral tag', () => {
      const g = goal({ track: 'none', suggested_hours: null, reason: 'no_magnitude', note: 'no mag note' })
      render(<ProjectCard project={merged({ goal: g })} selected={false} onSelect={vi.fn()} />)
      expect(screen.getByText('no goal')).toBeInTheDocument()
      expect(screen.getByText('no catalogued magnitude')).toBeInTheDocument()
      expect(screen.getByText('no catalogued magnitude').title).toBe('no mag note')
    })

    it('photometry not credible (IC 405, the real case): distinct wording, not blank', () => {
      render(
        <ProjectCard
          project={merged({
            targetId: 'IC405',
            targetName: 'IC 405',
            totalMinutes: 217.1667,
            store: null,
            sources: ['archive'],
            archiveMinutes: 217.1667,
            goal: IC405_GOAL,
          })}
          selected={false}
          onSelect={vi.fn()}
        />,
      )
      // Archive-only (no store record) no longer gets its own tag — the goal
      // math drives the tag exactly like a store-backed target's would …
      expect(screen.getByText('no goal')).toBeInTheDocument()
      expect(screen.queryByText('archive only', { exact: true })).not.toBeInTheDocument()
      // … but archive-only-ness isn't lost: the meta line still names it,
      // since summarizeSessions() returns null whenever there's no store
      // record, independent of the tag.
      expect(screen.getByText(/archive only — no per-session detail/)).toBeInTheDocument()
      // The goal line itself is no longer omitted just because there's no
      // store record — the goal is computed independently of tracking status,
      // and IC 405 (the user's single largest archive investment) must not
      // render as a bare blank.
      expect(screen.getByText('photometry not credible')).toBeInTheDocument()
      expect(screen.getByText('photometry not credible').title).toContain('not credible for this object class')
      expect(screen.getByTestId('progress-track').firstElementChild).toBeNull()
    })

    it('beyond practical reach: its own distinct tag and wording, not lumped in with "no goal"', () => {
      const g = goal({ beyond_reach: true, suggested_hours: null, surface_brightness: 27.0 })
      render(<ProjectCard project={merged({ goal: g })} selected={false} onSelect={vi.fn()} />)
      expect(screen.getByText('beyond reach')).toBeInTheDocument()
      expect(screen.getByText('beyond practical reach')).toBeInTheDocument()
      expect(screen.queryByText('no goal')).not.toBeInTheDocument()
      expect(screen.getByTestId('progress-track').firstElementChild).toBeNull()
    })
  })

  it('marks a coarse goal (cluster/planetary-nebula) with a "~" prefix, a real one without', () => {
    const { rerender } = render(
      <ProjectCard project={merged({ goal: goal({ coarse: true, suggested_hours: 2.0 }) })} selected={false} onSelect={vi.fn()} />,
    )
    expect(screen.getByText('of ~2.0 h suggested')).toBeInTheDocument()

    rerender(
      <ProjectCard project={merged({ goal: goal({ coarse: false, suggested_hours: 2.0 }) })} selected={false} onSelect={vi.fn()} />,
    )
    expect(screen.getByText('of 2.0 h suggested')).toBeInTheDocument()
  })

  it('says "suggested", never "needed"/"required"/"remaining" — the number is not a requirement', () => {
    render(<ProjectCard project={merged({ goal: goal({ suggested_hours: 6.0 }) })} selected={false} onSelect={vi.fn()} />)
    const label = screen.getByText(/suggested/)
    expect(label.textContent).toBe('of 6.0 h suggested')
    expect(label.textContent).not.toMatch(/needed|required|remaining|short of/i)
  })

  describe('hours/goal row layout (space-between, per README.md:654-655)', () => {
    it('keeps hours and the goal text as the same two flex-row siblings, in order, so a right-aligned layout separates them without reordering the DOM', () => {
      render(
        <ProjectCard
          project={merged({ totalMinutes: 84.2, goal: goal({ suggested_hours: 6.0 }) })}
          selected={false}
          onSelect={vi.fn()}
        />,
      )
      const hours = screen.getByText('1.4 h')
      const goalEl = screen.getByText('of 6.0 h suggested')
      expect(hours.parentElement).toBe(goalEl.parentElement)
      expect(Array.from(hours.parentElement!.children)).toEqual([hours, goalEl])
    })

    it('holds for the longest absent-state phrase too ("photometry not credible"), not just a short numeric goal', () => {
      render(
        <ProjectCard
          project={merged({ totalMinutes: 217.1667, goal: IC405_GOAL })}
          selected={false}
          onSelect={vi.fn()}
        />,
      )
      const hours = screen.getByText('3.6 h')
      const goalEl = screen.getByText('photometry not credible')
      expect(hours.parentElement).toBe(goalEl.parentElement)
      expect(Array.from(hours.parentElement!.children)).toEqual([hours, goalEl])
    })
  })

  describe('the doubling toggle sits inside the card and reserves its own space (design-review item A3)', () => {
    it('reserves room in the title row only when the toggle actually renders, so it never overlaps the status tag', () => {
      const { rerender } = render(
        <ProjectCard project={merged({ goal: goal() })} selected={false} onSelect={vi.fn()} />,
      )
      const titleRow = screen.getByText('M1').parentElement as HTMLElement
      expect(titleRow.className).toContain('titleRowReserved')

      rerender(<ProjectCard project={merged({ goal: null })} selected={false} onSelect={vi.fn()} />)
      const titleRowNoToggle = screen.getByText('M1').parentElement as HTMLElement
      expect(titleRowNoToggle.className).not.toContain('titleRowReserved')
    })
  })

  it('renders a progress track at the exact width implied by the ratio, colored by completion', () => {
    const p = merged({ totalMinutes: 30, goal: goal({ suggested_hours: 1.0 }) }) // 30/60 = 50%
    render(<ProjectCard project={p} selected={false} onSelect={vi.fn()} />)
    const track = screen.getByTestId('progress-track')
    const fill = track.firstElementChild as HTMLElement
    expect(fill.style.width).toBe('50%')
    expect(screen.getByText('needs data')).toBeInTheDocument()

    const complete = merged({ totalMinutes: 90, goal: goal({ suggested_hours: 1.0 }) }) // 150%, clamped
    const { container } = render(<ProjectCard project={complete} selected={false} onSelect={vi.fn()} />)
    const completeFill = container.querySelector('[data-testid="progress-track"]')?.firstElementChild as HTMLElement
    expect(completeFill.style.width).toBe('100%')
    expect(screen.getAllByText('complete').length).toBeGreaterThan(0)
  })

  describe('real fixture cases that clear their suggested goal (not contrived 50% cases)', () => {
    it('M42 (archive-only, 3.3h captured vs 1.2h suggested, ~279%): clamps the fill, not the hours text, and shows "complete" in the tag, not "archive only"', () => {
      render(<ProjectCard project={findReal('M42')} selected={false} onSelect={vi.fn()} />)
      expect(screen.getByText('3.3 h')).toBeInTheDocument() // the true captured value — never clamped
      expect(screen.getByText('of 1.2 h suggested')).toBeInTheDocument() // not coarse
      // Completion, not provenance, owns the tag slot now (see projectStatus's
      // doc comment) — a 279%-complete target must read as complete.
      expect(screen.getByText('complete')).toBeInTheDocument()
      expect(screen.queryByText('archive only', { exact: true })).not.toBeInTheDocument()
      // Archive-only-ness is still identifiable — just from the meta line,
      // not the tag.
      expect(screen.getByText(/archive only — no per-session detail/)).toBeInTheDocument()
      const track = screen.getByTestId('progress-track')
      const fill = track.firstElementChild as HTMLElement
      expect(fill.style.width).toBe('100%') // clamped from ~279%
      expect(fill.className).toContain('fillComplete') // met its goal — must not read as still in-progress
      expect(fill.className).not.toContain('fillProgress')
    })

    it('M27 (store-backed planetary nebula, coarse on the photometric track, ~151%): "~" prefix keyed off `coarse`, not `track`', () => {
      const m27 = findReal('M27')
      expect(m27.goal?.track).toBe('photometric') // NOT "cluster" — the real case the brief warned against keying on
      expect(m27.goal?.coarse).toBe(true)
      render(<ProjectCard project={m27} selected={false} onSelect={vi.fn()} />)
      expect(screen.getByText('of ~1.0 h suggested')).toBeInTheDocument()
      expect(screen.getByText('complete')).toBeInTheDocument() // store-backed, so the tag itself reflects completion
      const fill = screen.getByTestId('progress-track').firstElementChild as HTMLElement
      expect(fill.style.width).toBe('100%')
    })
  })

  it('Unknown (real archive folder that resolves to no catalogue record at all) reads distinctly from a resolved-but-unmeasurable target', () => {
    render(<ProjectCard project={findReal('Unknown')} selected={false} onSelect={vi.fn()} />)
    expect(screen.getByText('not in DSO catalogue')).toBeInTheDocument()
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

  it('calls onSelect when the card is clicked', () => {
    const onSelect = vi.fn()
    render(<ProjectCard project={merged()} selected={false} onSelect={onSelect} />)
    fireEvent.click(screen.getByTestId('project-card'))
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('reflects the selected prop via aria-pressed on the card, not the doubling toggle', () => {
    const { rerender } = render(<ProjectCard project={merged()} selected={false} onSelect={vi.fn()} />)
    expect(screen.getByTestId('project-card')).toHaveAttribute('aria-pressed', 'false')
    rerender(<ProjectCard project={merged()} selected onSelect={vi.fn()} />)
    expect(screen.getByTestId('project-card')).toHaveAttribute('aria-pressed', 'true')
  })

  describe('the doubling control (view-only, localStorage-persisted)', () => {
    it('only appears when there is a real number to double', () => {
      const { rerender } = render(<ProjectCard project={merged({ goal: null })} selected={false} onSelect={vi.fn()} />)
      expect(screen.queryByRole('button', { name: /Double/ })).not.toBeInTheDocument()

      rerender(
        <ProjectCard
          project={merged({ goal: goal({ beyond_reach: true, suggested_hours: null }) })}
          selected={false}
          onSelect={vi.fn()}
        />,
      )
      expect(screen.queryByRole('button', { name: /Double/ })).not.toBeInTheDocument()

      rerender(<ProjectCard project={merged({ goal: goal() })} selected={false} onSelect={vi.fn()} />)
      expect(screen.getByRole('button', { name: /Double/ })).toBeInTheDocument()
    })

    it('doubles the displayed hours and halves the fill width when toggled on', () => {
      const p = merged({ totalMinutes: 30, goal: goal({ suggested_hours: 1.0 }) }) // 50% undoubled
      render(<ProjectCard project={p} selected={false} onSelect={vi.fn()} />)
      expect(screen.getByText('of 1.0 h suggested')).toBeInTheDocument()
      const fillBefore = screen.getByTestId('progress-track').firstElementChild as HTMLElement
      expect(fillBefore.style.width).toBe('50%')

      fireEvent.click(screen.getByRole('button', { name: /Double/ }))

      expect(screen.getByText('of 2.0 h suggested')).toBeInTheDocument()
      const fillAfter = screen.getByTestId('progress-track').firstElementChild as HTMLElement
      expect(fillAfter.style.width).toBe('25%') // 30 / 120
    })

    it('does not fire the card-select handler when the toggle is clicked', () => {
      const onSelect = vi.fn()
      render(<ProjectCard project={merged({ goal: goal() })} selected={false} onSelect={onSelect} />)
      fireEvent.click(screen.getByRole('button', { name: /Double/ }))
      expect(onSelect).not.toHaveBeenCalled()
    })

    it('persists the doubled state across a remount (localStorage, keyed by target id)', () => {
      const p = merged({ targetId: 'M31', goal: goal() })
      const { unmount } = render(<ProjectCard project={p} selected={false} onSelect={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: /Double/ }))
      expect(screen.getByRole('button', { name: /Double/ })).toHaveAttribute('aria-pressed', 'true')
      unmount()

      render(<ProjectCard project={p} selected={false} onSelect={vi.fn()} />)
      expect(screen.getByRole('button', { name: /Double/ })).toHaveAttribute('aria-pressed', 'true')
    })

    it('does not let one target\'s doubled state leak onto a different target', () => {
      const a = merged({ targetId: 'M31', goal: goal({ suggested_hours: 1.0 }) })
      const b = merged({ targetId: 'M42', goal: goal({ suggested_hours: 1.0 }) })
      const { unmount } = render(<ProjectCard project={a} selected={false} onSelect={vi.fn()} />)
      fireEvent.click(screen.getByRole('button', { name: /Double/ }))
      unmount()

      render(<ProjectCard project={b} selected={false} onSelect={vi.fn()} />)
      expect(screen.getByRole('button', { name: /Double/ })).toHaveAttribute('aria-pressed', 'false')
    })

    it('degrades to un-doubled, without crashing, when localStorage holds junk', () => {
      localStorage.setItem('seestar-dashboard:doubled-goals:v1', '{not valid json')
      render(<ProjectCard project={merged({ goal: goal() })} selected={false} onSelect={vi.fn()} />)
      expect(screen.getByRole('button', { name: /Double/ })).toHaveAttribute('aria-pressed', 'false')
      expect(screen.getByText('of 3.0 h suggested')).toBeInTheDocument()
    })

    it('degrades to un-doubled, without crashing, when localStorage is unavailable', () => {
      const original = Object.getOwnPropertyDescriptor(window, 'localStorage')
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new Error('localStorage blocked in this context')
        },
      })
      try {
        render(<ProjectCard project={merged({ goal: goal() })} selected={false} onSelect={vi.fn()} />)
        expect(screen.getByText('of 3.0 h suggested')).toBeInTheDocument()
        fireEvent.click(screen.getByRole('button', { name: /Double/ }))
        // The click still updates this render's own state even though it
        // can't persist — a crash here would be worse than a lost toggle.
        expect(screen.getByText('of 6.0 h suggested')).toBeInTheDocument()
      } finally {
        if (original) Object.defineProperty(window, 'localStorage', original)
      }
    })
  })
})
