import { useState } from 'react'
import { LiveScreen } from './screens/live/LiveScreen'
import { ProjectsScreen } from './screens/projects/ProjectsScreen'
import { TonightScreen } from './screens/tonight/TonightScreen'
import { useShellData } from './shell/useShellData'
import type { View } from './shell/view'

export default function App() {
  const [view, setView] = useState<View>('tonight')
  // Shell-level data (site profile, replay status) is fetched once here and
  // threaded to both screens — see useShellData's docstring — so it isn't
  // re-fetched, and doesn't blank, on every navigation.
  const { site, health } = useShellData()

  if (view === 'projects') {
    return <ProjectsScreen view={view} onNavigate={setView} site={site} health={health} />
  }
  if (view === 'live') {
    return <LiveScreen view={view} onNavigate={setView} site={site} health={health} />
  }
  // 'review' has no screen yet (its nav row stays disabled), so anything
  // other than 'projects'/'live' falls through to Tonight.
  return <TonightScreen view={view} onNavigate={setView} site={site} health={health} />
}
