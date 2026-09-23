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
  nights: [],
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
  image: null,
  nights: [],
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

  it('carries the image field through from the combined entry', () => {
    const image = { url: '/api/target_image/M31', source: 'own' as const, credit: null }
    const combined = [combinedEntry({ target_id: 'M31', image })]
    const [result] = mergeProjects(combined, [])
    expect(result.image).toEqual(image)
  })

  it('normalizes a missing image field to null, not undefined', () => {
    const combined = [combinedEntry({ target_id: 'IC405' })]
    const [result] = mergeProjects(combined, [])
    expect(result.image).toBeNull()
  })

  it('carries the nights field through from the combined entry, verbatim', () => {
    const nights = [{ night: '2024-01-04', frames: 230, minutes: 38.3333 }]
    const combined = [combinedEntry({ target_id: 'M31', nights })]
    const [result] = mergeProjects(combined, [])
    expect(result.nights).toEqual(nights)
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

  it('holds sum(nights.minutes) === archiveMinutes for every one of the 33 real merged projects', () => {
    // The server-side invariant projects_union.py's combine_projects()
    // documents (nights is filtered through the exact same de-duplication
    // archive_minutes already uses) — checked here against the real fixture
    // rather than trusting the claim, and checked for every project, not
    // just the one (M31) this whole change was motivated by. A client bug
    // that dropped or duplicated a night while threading `nights` through
    // mergeProjects would show up here as a mismatch.
    const combined = ProjectsCombinedSchema.parse(recordedProjectsCombined()).projects
    const listed = ListProjectsSchema.parse(recordedListProjects()).projects
    const all = mergeProjects(combined, listed)
    expect(all).toHaveLength(33)
    expect(all.some((p) => p.nights.length > 0)).toBe(true) // exercises the real branch, not a fixture where it's vacuously true
    for (const p of all) {
      const summed = p.nights.reduce((total, n) => total + n.minutes, 0)
      expect(summed).toBeCloseTo(p.archiveMinutes, 3)
    }
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
  it('gives an archive-only target (no store record) the same completion tag a store-backed target would get for the same goal — no separate archive-only tag', () => {
    // Short of its goal: 'needs-data', same as any store-backed target.
    expect(projectStatus(merged({ store: null, goal: goal({ suggested_hours: 100 }) }), false).tag).toBe(
      'needs-data',
    )
    // Cleared its goal (the real M42 shape: archive-only, ~279% of goal):
    // 'complete', not a provenance tag — completion always wins the slot.
    expect(
      projectStatus(merged({ store: null, totalMinutes: 90, goal: goal({ suggested_hours: 1.0 }) }), false)
        .tag,
    ).toBe('complete')
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

  it('treats hitting the goal exactly as meeting it, not needs-data', () => {
    // The likeliest off-by-one mutation (>= vs >) lands exactly here.
    // Archive-only, so completion is the goal model's to state.
    const p = merged({ store: null, totalMinutes: 60, goal: goal({ suggested_hours: 1.0 }) })
    expect(projectStatus(p, false).tag).toBe('complete')
  })

  it('does not call a project complete 3 minutes short of a 10 h goal', () => {
    // 597 / 600 is 99.5%, which Math.round made 100.
    const p = merged({ store: null, totalMinutes: 597, goal: goal({ suggested_hours: 10 }) })
    expect(projectStatus(p, false).tag).toBe('needs-data')
  })

  it('doubling the goal can turn a complete project back to needs-data', () => {
    const p = merged({ store: null, totalMinutes: 90, goal: goal({ suggested_hours: 1.0 }) }) // 90 >= 60 undoubled
    expect(projectStatus(p, false).tag).toBe('complete')
    expect(projectStatus(p, true).tag).toBe('needs-data') // 90 < 120 doubled
  })

  describe('the server’s own project status is never contradicted', () => {
    // The sidecar's suggested goal is a display-only model. list_projects'
    // `status` ("active" | "complete" | "paused") is the server's, and the
    // server's planner acts on it — so a card must not say "complete" for a
    // project the server still lists as active.
    it('does not say complete for a store project the server lists as active', () => {
      const p = merged({
        totalMinutes: 90,
        goal: goal({ suggested_hours: 1.0 }),
        store: project({ status: 'active' }),
      })
      const status = projectStatus(p, false)

      expect(status.tag).not.toBe('complete')
      expect(status.label).toBe('active')
      expect(status.title).toMatch(/suggested/)
    })

    it('says complete when the server says complete, whatever the goal model thinks', () => {
      const p = merged({
        totalMinutes: 10,
        goal: goal({ suggested_hours: 1.0 }),
        store: project({ status: 'complete' }),
      })

      expect(projectStatus(p, false)).toMatchObject({ tag: 'complete', label: 'complete' })
    })

    it('shows any other server status verbatim', () => {
      const p = merged({
        totalMinutes: 10,
        goal: goal({ suggested_hours: 1.0 }),
        store: project({ status: 'paused' }),
      })

      expect(projectStatus(p, false)).toMatchObject({ tag: 'server-status', label: 'paused' })
    })

    it('the real M27 — active on the server, ~151% of its suggested goal — reads active', () => {
      const combined = ProjectsCombinedSchema.parse(recordedProjectsCombined()).projects
      const listed = ListProjectsSchema.parse(recordedListProjects()).projects
      const m27 = mergeProjects(combined, listed).find((p) => p.targetId === 'M27')!
      expect(m27.store?.status).toBe('active')

      expect(projectStatus(m27, false)).toMatchObject({ tag: 'server-status', label: 'active' })
    })
  })

  it('matches the real fixture distribution among the 15 store-backed projects: 12 needs-data, 2 no-goal, 1 active-past-goal, 0 complete', () => {
    const combined = ProjectsCombinedSchema.parse(recordedProjectsCombined()).projects
    const listed = ListProjectsSchema.parse(recordedListProjects()).projects
    const storeBacked = mergeProjects(combined, listed).filter((p) => p.store !== null)
    expect(storeBacked).toHaveLength(15)
    const counts: Record<string, number> = {}
    for (const p of storeBacked) {
      const tag = projectStatus(p, false).tag
      counts[tag] = (counts[tag] ?? 0) + 1
    }
    // Every store project in the recording is "active" on the server, so
    // none may read complete — M27 is past its suggested goal and reads
    // "active" instead.
    expect(counts).toEqual({ 'needs-data': 12, 'no-goal': 2, 'server-status': 1 })
  })

  it('matches the real fixture distribution across all 33 merged projects, archive-only included — the point of this fix', () => {
    // Independently computed against fixtures/projects_combined.json: two
    // archive-only targets (M42 ~279%, M81 ~152%) clear their own suggested
    // goal and must count as 'complete' here too, not fall out of the count
    // entirely under a provenance tag.
    const combined = ProjectsCombinedSchema.parse(recordedProjectsCombined()).projects
    const listed = ListProjectsSchema.parse(recordedListProjects()).projects
    const all = mergeProjects(combined, listed)
    expect(all).toHaveLength(33)
    const counts: Record<string, number> = {}
    for (const p of all) {
      const tag = projectStatus(p, false).tag
      counts[tag] = (counts[tag] ?? 0) + 1
    }
    expect(counts).toEqual({ 'needs-data': 22, 'no-goal': 8, complete: 2, 'server-status': 1 })
  })

  it('the real M42 (archive-only, ~279% of its suggested goal) reads complete, not archive-only', () => {
    const combined = ProjectsCombinedSchema.parse(recordedProjectsCombined()).projects
    const listed = ListProjectsSchema.parse(recordedListProjects()).projects
    const m42 = mergeProjects(combined, listed).find((p) => p.targetId === 'M42')
    expect(m42?.store).toBeNull() // archive-only, confirming this exercises the real case
    expect(projectStatus(m42 as MergedProject, false).tag).toBe('complete')
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
