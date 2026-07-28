import styles from './Dot.module.css'

export type DotTone = 'pass' | 'marginal' | 'reject' | 'accent' | 'idle'

export interface DotProps {
  tone: DotTone
  /** 6px in headers and nav, 5px in guardrail rows and chips. */
  size?: 'sm' | 'md'
}

/**
 * Every status dot renders through here.
 *
 * `data-dot` is not decoration. It is the only reliable way for a test to
 * assert that no dot of a given tone is on screen — and a guard that queried
 * that attribute while nothing set it passed vacuously for a whole task. One
 * component makes the attribute a guarantee rather than a convention.
 */
export function Dot({ tone, size = 'md' }: DotProps) {
  return (
    <span
      data-testid="dot"
      data-dot={tone}
      className={`${styles.dot} ${styles[size]} ${styles[tone]}`}
    />
  )
}
