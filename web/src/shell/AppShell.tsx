import type { ReactNode } from 'react'
import styles from './AppShell.module.css'

interface Props {
  topBar: ReactNode
  sidebar: ReactNode
  children: ReactNode
}

/** Only the content column scrolls. */
export function AppShell({ topBar, sidebar, children }: Props) {
  return (
    <div className={styles.root}>
      {topBar}
      <div className={styles.body}>
        {sidebar}
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  )
}
