import { useState } from 'react'
import { LiveScreen } from './screens/live/LiveScreen'
import { ProjectsScreen } from './screens/projects/ProjectsScreen'
import { ReviewScreen } from './screens/review/ReviewScreen'
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
  if (view === 'review') {
    return <ReviewScreen view={view} onNavigate={setView} site={site} health={health} />
  }
  // Anything else falls through to Tonight, which is also the initial view.
  return <TonightScreen view={view} onNavigate={setView} site={site} health={health} />
}
