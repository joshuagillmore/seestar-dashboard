import styles from './Dot.module.css'

export type DotTone = 'pass' | 'marginal' | 'reject' | 'accent' | 'idle'

export interface DotProps {
  tone: DotTone
  /** 6px in headers and nav, 5px in guardrail rows and chips. */
  size?: 'sm' | 'md'
  /** Merged alongside the component's own classes, for a caller that needs to
   * adjust layout (margin, alignment) around a dot — guardrail rows, the chat
   * header and chips from slice 3 on. Additive only: there is no way to pass
   * `data-dot` itself, so a caller can add to the element but never touch the
   * attribute that makes it a guarantee (see the class doc comment below). */
  className?: string
}

/**
 * Every status dot renders through here.
 *
 * `data-dot` is not decoration. It is the only reliable way for a test to
 * assert that no dot of a given tone is on screen — and a guard that queried
 * that attribute while nothing set it passed vacuously for a whole task. One
 * component makes the attribute a guarantee rather than a convention.
 *
 * That's also why this never spreads a caller's props onto the element: only
 * `className` is accepted, and only ever appended, never in place of the
 * component's own `${styles[size]} ${styles[tone]}` classes. A caller cannot
 * reach `data-dot` at all, by construction, whatever it tries to pass.
 */
export function Dot({ tone, size = 'md', className }: DotProps) {
  return (
    <span
      data-testid="dot"
      data-dot={tone}
      className={`${styles.dot} ${styles[size]} ${styles[tone]}${className ? ` ${className}` : ''}`}
    />
  )
}
