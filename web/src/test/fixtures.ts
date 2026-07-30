import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..', '..', '..', 'fixtures')

export const loadFixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(ROOT, `${name}.json`), 'utf8'))

export const recordedConditions = () => loadFixture('assess_conditions')
export const recordedPlan = () => loadFixture('plan_targets')
export const recordedSite = () => loadFixture('get_site_profile')
export const goConditions = () => loadFixture('synthetic/assess_conditions.go')
export const unknownConditions = () => loadFixture('synthetic/assess_conditions.unknown')
export const recordedListProjects = () => loadFixture('list_projects')
/** Not an MCP tool fixture recorded by record.py — projects_combined is a
 * sidecar-computed route (list_projects + a real archive scan), so this was
 * generated once by running that same computation directly against the
 * recorded list_projects.json and the real archive directory. See the sidecar
 * report for how; the numbers here are real (33 targets, ~30.6h total). */
export const recordedProjectsCombined = () => loadFixture('projects_combined')
