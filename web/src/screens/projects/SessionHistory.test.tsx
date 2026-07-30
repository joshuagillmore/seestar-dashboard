import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { SessionHistory } from './SessionHistory'
import type { MergedProject } from './projects'
import type { Project, SessionRecord } from '../../api/schemas'

const session = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  date_utc: '2026-07-12T06:07:08+00:00',
  integration_minutes: 22,
  subs_total: 132,
  subs_kept: 130,
  median_fwhm: null,
  notes: '',
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
  ...overrides,
})

describe('SessionHistory', () => {
  it('shows an honest empty state naming the target for an archive-only project', () => {
    render(<SessionHistory project={merged({ targetName: 'IC 405', store: null })} />)
    expect(screen.getByText(/IC 405 appears only in the archive scan/)).toBeInTheDocument()
    expect(screen.queryByRole('row')).not.toBeInTheDocument()
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

  it('notes the un-itemised archive minutes when the target also has archive data (e.g. M31)', () => {
    render(
      <SessionHistory
        project={merged({
          archiveMinutes: 38.3333,
          store: project({ sessions: [session()] }),
        })}
      />,
    )
    expect(
      screen.getByText('plus 38.3 min from the archive, not itemised per night here.'),
    ).toBeInTheDocument()
  })

  it('omits the archive note for a target with no archive contribution', () => {
    render(<SessionHistory project={merged({ archiveMinutes: 0, store: project({ sessions: [session()] }) })} />)
    expect(screen.queryByText(/from the archive/)).not.toBeInTheDocument()
  })

  it('still notes un-itemised archive minutes when the tracked project has no sessions yet', () => {
    render(
      <SessionHistory
        project={merged({ archiveMinutes: 17, store: project({ sessions: [] }) })}
      />,
    )
    expect(screen.getByText(/plus 17\.0 min from the archive/)).toBeInTheDocument()
  })

  it('does not duplicate the archive-minutes note for an archive-only target — its empty state already explains the provenance', () => {
    render(<SessionHistory project={merged({ store: null, archiveMinutes: 217.2 })} />)
    expect(screen.queryByText(/not itemised per night here/)).not.toBeInTheDocument()
  })
})
