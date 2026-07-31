import type { View } from './view'
import styles from './MobileNav.module.css'

const ITEMS: { view: View; label: string }[] = [
  { view: 'tonight', label: 'Tonight' },
  { view: 'live', label: 'Live' },
]

export interface MobileNavProps {
  view: View
  onNavigate: (view: View) => void
}

/**
 * Design divergence, not a design spec — write-up for the divergence record:
 * the design's Mobile section (README.md:685-727) shows both phone screens
 * side by side in one static mockup, so it never had to answer "how does a
 * phone user get from one screen to the other." Dropping AppShell's chrome
 * below the mobile breakpoint (see LiveScreen.tsx/TonightScreen.tsx's own
 * doc comments) removed the only thing in the running app that ever called
 * `onNavigate` — without this, the two mobile screens built from that
 * section would be mutually unreachable on a real phone.
 *
 * Deliberately NOT a port of `Sidebar`: no site-profile block, no verdict/
 * live status dots, no disabled Review/Projects rows for screens that have
 * no mobile layout at all (design README.md: "Mobile covers exactly two
 * screens"). Two targets, sized to the design's own 44px minimum
 * (README.md:723-724) — the smallest thing that makes both screens
 * reachable, nothing more.
 */
export function MobileNav({ view, onNavigate }: MobileNavProps) {
  return (
    <nav className={styles.nav} aria-label="Mobile navigation">
      {ITEMS.map((item) => {
        const active = view === item.view
        return (
          <button
            key={item.view}
            type="button"
            className={`${styles.tab} ${active ? styles.tabActive : ''}`}
            aria-current={active ? 'page' : undefined}
            onClick={() => onNavigate(item.view)}
          >
            {item.label}
          </button>
        )
      })}
    </nav>
  )
}
