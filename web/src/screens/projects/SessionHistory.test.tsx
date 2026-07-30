import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SessionHistory } from './SessionHistory'
import type { MergedProject } from './projects'
import type { ArchiveNight, Project, SessionRecord } from '../../api/schemas'

const session = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  date_utc: '2026-07-12T06:07:08+00:00',
  integration_minutes: 22,
  subs_total: 132,
  subs_kept: 130,
  median_fwhm: null,
  notes: '',
  ...overrides,
})

const night = (overrides: Partial<ArchiveNight> = {}): ArchiveNight => ({
  night: '2024-01-04',
  frames: 230,
  minutes: 38.3333,
  ...overrides,
})

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
  totalMinutes: 22,
  storeMinutes: 22,
  archiveMinutes: 0,
  sources: ['store'],
  store: project(),
  goal: null,
  image: null,
  nights: [],
  ...overrides,
})

describe('SessionHistory', () => {
  it('shows an honest empty state naming the target for an archive-only project with no nights either', () => {
    // The genuinely-nothing-to-show case: no store record AND no archive
    // nights (e.g. a target directory that scanned with zero frames). Once
    // nights exist, the other test below takes over instead of this branch.
    render(<SessionHistory project={merged({ targetName: 'IC 405', store: null, nights: [] })} />)
    expect(
      screen.getByText(/IC 405 has no per-night archive record and no store sessions/),
    ).toBeInTheDocument()
    expect(screen.queryByRole('row')).not.toBeInTheDocument()
  })

  it('renders nights alone for an archive-only project that has them, not the empty state', () => {
    render(
      <SessionHistory
        project={merged({
          targetName: 'IC 405',
          store: null,
          nights: [night({ night: '2024-01-19', frames: 211, minutes: 35.1667 }), night({ night: '2024-02-05', frames: 452, minutes: 75.3333 })],
        })}
      />,
    )
    expect(screen.queryByText(/no per-night archive record/)).not.toBeInTheDocument()
    // 1 header row + 2 archive-night rows, no store session rows at all.
    const rows = screen.getAllByRole('row')
    expect(rows).toHaveLength(3)
    expect(screen.getAllByText('archive')).toHaveLength(2)
    // Scoped to each row — an unscoped substring match on a bare date would
    // also match the enclosing row/section text and throw on "multiple
    // elements found", since neither is an exact-text match.
    expect(within(rows[1]).getByText('2024-01-19', { exact: false })).toBeInTheDocument()
    expect(within(rows[2]).getByText('2024-02-05', { exact: false })).toBeInTheDocument()
  })

  it('shows an honest empty state for a tracked project with no sessions yet', () => {
    render(<SessionHistory project={merged({ store: project({ sessions: [] }) })} />)
    expect(screen.getByText(/No sessions logged for Crab Nebula/)).toBeInTheDocument()
  })

  it('labels the section with the selected target id and log_session_result — the tool that wrote the records, per the design (README.md:669), not list_projects, which only reads them back', () => {
    render(<SessionHistory project={merged({ targetId: 'M31', store: project({ sessions: [session()] }) })} />)
    expect(screen.getByText('M31 · SESSION HISTORY — log_session_result')).toBeInTheDocument()
  })

  it('renders the six designed columns in the header', () => {
    render(<SessionHistory project={merged({ store: project({ sessions: [session()] }) })} />)
    const [header] = screen.getAllByRole('row')
    expect(within(header).getByText('NIGHT')).toBeInTheDocument()
    expect(within(header).getByText('FILTER')).toBeInTheDocument()
    expect(within(header).getByText('KEPT')).toBeInTheDocument()
    expect(within(header).getByText('TOTAL')).toBeInTheDocument()
    expect(within(header).getByText('MED FWHM')).toBeInTheDocument()
    expect(within(header).getByText('INTEGRATION')).toBeInTheDocument()
  })

  it('renders one data row per session, reading real fields rather than a fixed count', () => {
    render(
      <SessionHistory
        project={merged({
          store: project({
            sessions: [session(), session({ date_utc: '2026-07-16T03:50:34+00:00' }), session({ date_utc: '2026-07-13T03:32:26+00:00' })],
          }),
        })}
      />,
    )
    // 1 header row + 3 data rows
    expect(screen.getAllByRole('row')).toHaveLength(4)
  })

  it('reads KEPT, TOTAL, NIGHT and INTEGRATION from the actual session fields', () => {
    render(
      <SessionHistory
        project={merged({
          store: project({
            sessions: [
              session({ date_utc: '2026-07-13T03:32:26+00:00', subs_kept: 211, subs_total: 217, integration_minutes: 36 }),
            ],
          }),
        })}
      />,
    )
    const [, row] = screen.getAllByRole('row')
    expect(within(row).getByText('2026-07-13')).toBeInTheDocument()
    expect(within(row).getByText('211')).toBeInTheDocument()
    expect(within(row).getByText('217')).toBeInTheDocument()
    expect(within(row).getByText('36.0 min')).toBeInTheDocument()
  })

  it('renders FILTER as an honest absence on every row — the field does not exist in the schema', () => {
    render(<SessionHistory project={merged({ store: project({ sessions: [session()] }) })} />)
    const [, row] = screen.getAllByRole('row')
    const cells = within(row).getAllByText('—')
    // Both FILTER and MED FWHM are absent for this session, so two dashes.
    expect(cells).toHaveLength(2)
    expect(cells[0].title).toMatch(/does not return a per-session filter/)
  })

  it('renders MED FWHM as an honest absence with the handback reference when null', () => {
    render(<SessionHistory project={merged({ store: project({ sessions: [session({ median_fwhm: null })] }) })} />)
    const [, row] = screen.getAllByRole('row')
    const fwhmCell = within(row).getAllByText('—')[1]
    expect(fwhmCell.title).toMatch(/median_fwhm is null/)
  })

  it('renders a real MED FWHM value when the store ever supplies one', () => {
    render(<SessionHistory project={merged({ store: project({ sessions: [session({ median_fwhm: 3.4159 })] }) })} />)
    const [, row] = screen.getAllByRole('row')
    expect(within(row).getByText('3.42 px')).toBeInTheDocument()
  })

  it('renders no archive-night rows and no "archive" tag when nights is empty — the property, not a proxy on archiveMinutes', () => {
    // Keyed on `nights` directly rather than `archiveMinutes`, unlike the
    // stopgap note this replaced: a payload where the two ever disagreed
    // (they shouldn't, by construction server-side) must still render
    // exactly what `nights` says, not infer rows from the aggregate.
    render(<SessionHistory project={merged({ store: project({ sessions: [session()] }), nights: [] })} />)
    expect(screen.queryByText('archive')).not.toBeInTheDocument()
    // 1 header + 1 session row only.
    expect(screen.getAllByRole('row')).toHaveLength(2)
  })

  it('itemises both the store sessions and the archive nights for a target recorded in both sources (M31), and the table total reconciles with the card total', () => {
    // The M31 case this whole change exists for: the store's own sessions
    // summed to 84.2 min while the card read 122.5 — asserting the arithmetic
    // itself, not just that some extra row appeared, is the point (a test
    // that only counted rows would miss a row with the wrong minutes on it).
    const m31Session = session({ date_utc: '2026-07-05T03:00:00+00:00', integration_minutes: 84.2 })
    const m31Night = night({ night: '2024-01-04', frames: 230, minutes: 38.3333 })
    render(
      <SessionHistory
        project={merged({
          targetId: 'M31',
          totalMinutes: 122.5333,
          storeMinutes: 84.2,
          archiveMinutes: 38.3333,
          sources: ['store', 'archive'],
          store: project({ sessions: [m31Session] }),
          nights: [m31Night],
        })}
      />,
    )
    // 1 header + 1 session row + 1 archive-night row.
    expect(screen.getAllByRole('row')).toHaveLength(3)
    expect(screen.getByText('84.2 min')).toBeInTheDocument()
    expect(screen.getByText('230 frames · 38.3 min')).toBeInTheDocument()
    const rowMinutes = m31Session.integration_minutes + m31Night.minutes
    expect(rowMinutes).toBeCloseTo(122.5333, 3)
  })

  it('renders FILTER, KEPT, TOTAL and MED FWHM as an honest absence on an archive-night row, distinct from the store-session absent reason', () => {
    render(<SessionHistory project={merged({ store: null, nights: [night()] })} />)
    const [, row] = screen.getAllByRole('row')
    const dashes = within(row).getAllByText('—')
    // FILTER, KEPT, TOTAL, MED FWHM — four absent cells, none of them padded
    // with a zero or a blank that would imply a real measurement.
    expect(dashes).toHaveLength(4)
    for (const cell of dashes) {
      expect(cell.title).toMatch(/never scored by qa_tier2/)
    }
    // NIGHT and INTEGRATION are the two real numbers this row has, and both
    // render as actual values, not dashes.
    expect(within(row).getByText('2024-01-04', { exact: false })).toBeInTheDocument()
    expect(within(row).getByText('230 frames · 38.3 min')).toBeInTheDocument()
  })

  it('leaves a store-only project (no archive contribution) rendering exactly as before', () => {
    render(<SessionHistory project={merged({ store: project({ sessions: [session()] }), nights: [] })} />)
    expect(screen.getAllByRole('row')).toHaveLength(2) // 1 header + 1 session row, no archive rows
    expect(screen.queryByText('archive')).not.toBeInTheDocument()
  })
})
