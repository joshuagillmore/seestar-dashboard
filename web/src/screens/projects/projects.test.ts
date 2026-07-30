import { describe, expect, it } from 'vitest'
import {
  formatHours,
  formatMinutes,
  mergeProjects,
  progressPct,
  projectStatus,
  provenanceLabel,
  summarizeSessions,
  type MergedProject,
} from './projects'
import type { Project, ProjectsCombinedEntry, SessionRecord } from '../../api/schemas'
import { ListProjectsSchema, ProjectsCombinedSchema } from '../../api/schemas'
import { recordedListProjects, recordedProjectsCombined } from '../../test/fixtures'

const session = (overrides: Partial<SessionRecord> = {}): SessionRecord => ({
  date_utc: '2026-07-12T06:00:00+00:00',
  integration_minutes: 20,
  subs_total: 100,
  subs_kept: 100,
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

const combinedEntry = (overrides: Partial<ProjectsCombinedEntry> = {}): ProjectsCombinedEntry => ({
  target_id: 'M1',
  target_name: 'Crab Nebula',
  store_minutes: 0,
  archive_minutes: 0,
  sources: ['store'],
  total_minutes: 0,
  ...overrides,
})

const merged = (overrides: Partial<MergedProject> = {}): MergedProject => ({
  targetId: 'M1',
  targetName: 'Crab Nebula',
  totalMinutes: 0,
  storeMinutes: 0,
  archiveMinutes: 0,
  sources: ['store'],
  store: project(),
  ...overrides,
})

describe('mergeProjects', () => {
  it('attaches the matching list_projects record by target_id', () => {
    const combined = [combinedEntry({ target_id: 'M31', target_name: 'Andromeda Galaxy' })]
    const listed = [project({ target_id: 'M31', target_name: 'Andromeda Galaxy', goal_minutes: 360 })]
    const [result] = mergeProjects(combined, listed)
    expect(result.store?.goal_minutes).toBe(360)
  })

  it('leaves store null for a target with no matching list_projects record', () => {
    const combined = [combinedEntry({ target_id: 'IC405', sources: ['archive'] })]
    const [result] = mergeProjects(combined, [])
    expect(result.store).toBeNull()
  })

  it('preserves the input order from `combined` rather than re-sorting', () => {
    // Deliberately NOT in target_id or total_minutes order — proves this
    // function doesn't quietly impose its own ordering on top of the
    // server's, which is the one property that would break silently.
    const combined = [
      combinedEntry({ target_id: 'ZZZ', total_minutes: 5 }),
      combinedEntry({ target_id: 'AAA', total_minutes: 500 }),
    ]
    const result = mergeProjects(combined, [])
    expect(result.map((r) => r.targetId)).toEqual(['ZZZ', 'AAA'])
  })

  it('matches the real fixtures: 15 store-backed, 18 archive-only, of 33 total', () => {
    const combined = ProjectsCombinedSchema.parse(recordedProjectsCombined()).projects
    const listed = ListProjectsSchema.parse(recordedListProjects()).projects
    const result = mergeProjects(combined, listed)
    expect(result).toHaveLength(33)
    expect(result.filter((p) => p.store !== null)).toHaveLength(15)
    expect(result.filter((p) => p.store === null)).toHaveLength(18)
  })

  it('gives M31 both store and archive minutes matching the recorded split', () => {
    const combined = ProjectsCombinedSchema.parse(recordedProjectsCombined()).projects
    const listed = ListProjectsSchema.parse(recordedListProjects()).projects
    const m31 = mergeProjects(combined, listed).find((p) => p.targetId === 'M31')
    expect(m31?.storeMinutes).toBeCloseTo(84.2, 1)
    expect(m31?.archiveMinutes).toBeCloseTo(38.3, 1)
    expect(m31?.sources).toEqual(['store', 'archive'])
  })
})

describe('projectStatus', () => {
  it('tags an archive-only target (no store record) as archive-only', () => {
    expect(projectStatus(merged({ store: null })).tag).toBe('archive-only')
  })

  it('tags a store project with no goal as no-goal', () => {
    expect(projectStatus(merged({ store: project({ goal_minutes: 0 }) })).tag).toBe('no-goal')
  })

  it('tags a store project short of its goal as needs-data', () => {
    const p = merged({ totalMinutes: 30, store: project({ goal_minutes: 60 }) })
    expect(projectStatus(p).tag).toBe('needs-data')
  })

  it('tags a store project past its goal as complete', () => {
    const p = merged({ totalMinutes: 90, store: project({ goal_minutes: 60 }) })
    expect(projectStatus(p).tag).toBe('complete')
  })

  it('treats hitting the goal exactly as complete, not needs-data', () => {
    // The likeliest off-by-one mutation (>= vs >) lands exactly here.
    const p = merged({ totalMinutes: 60, store: project({ goal_minutes: 60 }) })
    expect(projectStatus(p).tag).toBe('complete')
  })

  it('every real project is archive-only or no-goal — none reach needs-data/complete', () => {
    const combined = ProjectsCombinedSchema.parse(recordedProjectsCombined()).projects
    const listed = ListProjectsSchema.parse(recordedListProjects()).projects
    const tags = new Set(mergeProjects(combined, listed).map((p) => projectStatus(p).tag))
    expect(tags).toEqual(new Set(['archive-only', 'no-goal']))
  })
})

describe('progressPct', () => {
  it('is null for an archive-only target', () => {
    expect(progressPct(merged({ store: null }))).toBeNull()
  })

  it('is null when goal_minutes is 0', () => {
    expect(progressPct(merged({ store: project({ goal_minutes: 0 }) }))).toBeNull()
  })

  it('computes a rounded percentage against the goal', () => {
    const p = merged({ totalMinutes: 20, store: project({ goal_minutes: 60 }) }) // 33.33%
    expect(progressPct(p)).toBe(33)
    const q = merged({ totalMinutes: 40, store: project({ goal_minutes: 60 }) }) // 66.67%
    expect(progressPct(q)).toBe(67)
  })

  it('clamps at 100 rather than reporting over-completion', () => {
    const p = merged({ totalMinutes: 150, store: project({ goal_minutes: 60 }) })
    expect(progressPct(p)).toBe(100)
  })

  it('no real project has a non-null progress percentage today', () => {
    const combined = ProjectsCombinedSchema.parse(recordedProjectsCombined()).projects
    const listed = ListProjectsSchema.parse(recordedListProjects()).projects
    const result = mergeProjects(combined, listed)
    expect(result.length).toBeGreaterThan(0)
    expect(result.every((p) => progressPct(p) === null)).toBe(true)
  })
})

describe('formatHours / formatMinutes', () => {
  it('formats hours to one decimal with a unit suffix', () => {
    expect(formatHours(180)).toBe('3.0 h')
    expect(formatHours(37)).toBe('0.6 h')
  })

  it('formats minutes to one decimal with a unit suffix', () => {
    expect(formatMinutes(84.2)).toBe('84.2 min')
    expect(formatMinutes(38.3333)).toBe('38.3 min')
  })
})

describe('provenanceLabel', () => {
  it('names only the store when sources is store-only', () => {
    const p = merged({ sources: ['store'], storeMinutes: 22, archiveMinutes: 0 })
    expect(provenanceLabel(p)).toBe('22.0 min store')
  })

  it('names only the archive when sources is archive-only', () => {
    const p = merged({ sources: ['archive'], storeMinutes: 0, archiveMinutes: 217.2 })
    expect(provenanceLabel(p)).toBe('217.2 min archive')
  })

  it('joins both, store first, when both contributed', () => {
    const p = merged({ sources: ['store', 'archive'], storeMinutes: 84.2, archiveMinutes: 38.3 })
    expect(provenanceLabel(p)).toBe('84.2 min store + 38.3 min archive')
  })
})

describe('summarizeSessions', () => {
  it('is null for an archive-only target — there is no per-session detail to summarize', () => {
    expect(summarizeSessions(merged({ store: null }))).toBeNull()
  })

  it('reports "no sessions logged" for a tracked project with an empty sessions array', () => {
    const result = summarizeSessions(merged({ store: project({ sessions: [] }) }))
    expect(result).toEqual({ text: 'no sessions logged', fwhmAbsent: false })
  })

  it('counts sessions and singularizes exactly one', () => {
    const one = summarizeSessions(merged({ store: project({ sessions: [session()] }) }))
    expect(one?.text).toContain('1 session ·')
    expect(one?.text).not.toContain('1 sessions')

    const three = summarizeSessions(
      merged({ store: project({ sessions: [session(), session(), session()] }) }),
    )
    expect(three?.text).toContain('3 sessions ·')
  })

  it('picks the chronologically latest session by date_utc, not the last array element', () => {
    const result = summarizeSessions(
      merged({
        store: project({
          sessions: [
            session({ date_utc: '2026-07-16T07:10:12+00:00' }), // latest, listed first
            session({ date_utc: '2026-07-12T06:00:00+00:00' }), // listed last
          ],
        }),
      }),
    )
    expect(result?.text).toContain('last 2026-07-16')
  })

  it('reports the absent FWHM as a dash and flags it, rather than fabricating a number', () => {
    const result = summarizeSessions(
      merged({ store: project({ sessions: [session({ median_fwhm: null })] }) }),
    )
    expect(result?.text).toContain('med FWHM —')
    expect(result?.fwhmAbsent).toBe(true)
  })

  it('renders a real FWHM value when the store ever supplies one', () => {
    const result = summarizeSessions(
      merged({ store: project({ sessions: [session({ median_fwhm: 3.4159 })] }) }),
    )
    expect(result?.text).toContain('med FWHM 3.42 px')
    expect(result?.fwhmAbsent).toBe(false)
  })

  it('every real store-backed project summarizes with an absent FWHM today', () => {
    const listed = ListProjectsSchema.parse(recordedListProjects()).projects
    expect(listed.length).toBeGreaterThan(0)
    for (const p of listed) {
      const result = summarizeSessions(merged({ store: p }))
      expect(result?.fwhmAbsent).toBe(true)
    }
  })
})
