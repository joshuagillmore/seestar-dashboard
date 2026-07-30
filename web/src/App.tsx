import { useState } from 'react'
import { ProjectsScreen } from './screens/projects/ProjectsScreen'
import { TonightScreen } from './screens/tonight/TonightScreen'
import type { View } from './shell/view'

export default function App() {
  const [view, setView] = useState<View>('tonight')

  if (view === 'projects') {
    return <ProjectsScreen view={view} onNavigate={setView} />
  }
  // 'live' and 'review' have no screen yet (their nav rows stay disabled),
  // so anything other than 'projects' falls through to Tonight.
  return <TonightScreen view={view} onNavigate={setView} />
}
