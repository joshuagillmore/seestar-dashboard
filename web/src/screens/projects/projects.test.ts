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
import type { IntegrationGoal, Project, ProjectsCombinedEntry, SessionRecord } from '../../api/schemas'
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

/** A normal (not coarse, not beyond-reach) numeric goal — the common case on
 * the photometric track. Override individual fields for the other states. */
const goal = (overrides: Partial<IntegrationGoal> = {}): IntegrationGoal => ({
  track: 'photometric',
  suggested_hours: 3.0,
  coarse: false,
  beyond_reach: false,
  surface_brightness: 23.3,
  bortle_multiplier: 1.0,
  reason: null,
  note: 'SB 23.30 mag/arcsec² → suggested 3.0 h.',
  ...overrides,
})

const combinedEntry = (overrides: Partial<ProjectsCombinedEntry> = {}): ProjectsCombinedEntry => ({
  target_id: 'M1',
  target_name: 'Crab Nebula',
  store_minutes: 0,
  archive_minutes: 0,
  sources: ['store'],
  total_minutes: 0,
  goal: null,
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
  goal: null,
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

  it('carries the goal field through from the combined entry, independent of store', () => {
    const g = goal({ reason: 'photometry_unreliable', track: 'none', suggested_hours: null })
    const combined = [combinedEntry({ target_id: 'IC405', sources: ['archive'], goal: g })]
    const [result] = mergeProjects(combined, [])
    expect(result.store).toBeNull()
    expect(result.goal).toEqual(g)
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
  it('tags an archive-only target (no store record) as archive-only, regardless of its goal', () => {
    expect(projectStatus(merged({ store: null, goal: goal() }), false).tag).toBe('archive-only')
  })

  it('tags a store project with no catalogue record as no-goal', () => {
    expect(projectStatus(merged({ goal: null }), false).tag).toBe('no-goal')
  })

  it('tags a store project with track "none" (no magnitude / unreliable photometry) as no-goal', () => {
    const noMag = goal({ track: 'none', suggested_hours: null, reason: 'no_magnitude' })
    expect(projectStatus(merged({ goal: noMag }), false).tag).toBe('no-goal')
  })

  it('tags a beyond-reach goal distinctly, not as no-goal', () => {
    const beyond = goal({ beyond_reach: true, suggested_hours: null })
    expect(projectStatus(merged({ goal: beyond }), false).tag).toBe('beyond-reach')
  })

  it('tags a store project short of its suggested goal as needs-data', () => {
    const p = merged({ totalMinutes: 30, goal: goal({ suggested_hours: 1.0 }) }) // 60 min goal
    expect(projectStatus(p, false).tag).toBe('needs-data')
  })

  it('tags a store project past its suggested goal as complete', () => {
    const p = merged({ totalMinutes: 90, goal: goal({ suggested_hours: 1.0 }) })
    expect(projectStatus(p, false).tag).toBe('complete')
  })

  it('treats hitting the goal exactly as complete, not needs-data', () => {
    // The likeliest off-by-one mutation (>= vs >) lands exactly here.
    const p = merged({ totalMinutes: 60, goal: goal({ suggested_hours: 1.0 }) })
    expect(projectStatus(p, false).tag).toBe('complete')
  })

  it('doubling the goal can turn a complete project back to needs-data', () => {
    const p = merged({ totalMinutes: 90, goal: goal({ suggested_hours: 1.0 }) }) // 90 >= 60 undoubled
    expect(projectStatus(p, false).tag).toBe('complete')
    expect(projectStatus(p, true).tag).toBe('needs-data') // 90 < 120 doubled
  })

  it('matches the real fixture distribution among the 15 store-backed projects: 12 needs-data, 2 no-goal, 1 complete, 0 beyond-reach', () => {
    const combined = ProjectsCombinedSchema.parse(recordedProjectsCombined()).projects
    const listed = ListProjectsSchema.parse(recordedListProjects()).projects
    const storeBacked = mergeProjects(combined, listed).filter((p) => p.store !== null)
    expect(storeBacked).toHaveLength(15)
    const counts: Record<string, number> = {}
    for (const p of storeBacked) {
      const tag = projectStatus(p, false).tag
      counts[tag] = (counts[tag] ?? 0) + 1
    }
    expect(counts).toEqual({ 'needs-data': 12, 'no-goal': 2, complete: 1 })
  })
})

describe('progressPct', () => {
  it('is null for a target with no catalogue record at all', () => {
    expect(progressPct(merged({ goal: null }), false)).toBeNull()
  })

  it('is null for a track "none" goal (no magnitude / unreliable photometry)', () => {
    const noMag = goal({ track: 'none', suggested_hours: null, reason: 'no_magnitude' })
    expect(progressPct(merged({ goal: noMag }), false)).toBeNull()
  })

  it('is null for a beyond-reach goal', () => {
    expect(progressPct(merged({ goal: goal({ beyond_reach: true, suggested_hours: null }) }), false)).toBeNull()
  })

  it('computes a rounded percentage against the suggested hours', () => {
    const p = merged({ totalMinutes: 20, goal: goal({ suggested_hours: 1.0 }) }) // 20/60 = 33.33%
    expect(progressPct(p, false)).toBe(33)
    const q = merged({ totalMinutes: 40, goal: goal({ suggested_hours: 1.0 }) }) // 40/60 = 66.67%
    expect(progressPct(q, false)).toBe(67)
  })

  it('clamps at 100 rather than reporting over-completion', () => {
    const p = merged({ totalMinutes: 150, goal: goal({ suggested_hours: 1.0 }) })
    expect(progressPct(p, false)).toBe(100)
  })

  it('halves the percentage when the goal is doubled', () => {
    const p = merged({ totalMinutes: 30, goal: goal({ suggested_hours: 1.0 }) }) // 30/60 = 50%
    expect(progressPct(p, false)).toBe(50)
    expect(progressPct(p, true)).toBe(25) // 30/120
  })

  it('matches the recorded M31 percentage against its real suggested goal', () => {
    const combined = ProjectsCombinedSchema.parse(recordedProjectsCombined()).projects
    const listed = ListProjectsSchema.parse(recordedListProjects()).projects
    const m31 = mergeProjects(combined, listed).find((p) => p.targetId === 'M31')
    expect(m31?.goal?.suggested_hours).toBeCloseTo(2.9, 1)
    // 122.5333 min / (2.9 h * 60) = ~70.4%
    expect(progressPct(m31 as MergedProject, false)).toBe(70)
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
