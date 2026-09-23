import type { Guardrails } from '../../api/schemas'
import { Dot, type DotTone } from '../../ui/Dot'
import styles from './GuardrailsCard.module.css'

export interface GuardrailsCardProps {
  /** `null` on fetch failure — degrades to an absent card, not a crash; see
   * useLiveSession's per-endpoint soft-fail. */
  guardrails: Guardrails | null
}

/**
 * design README.md:474-487 pictures five named, individually-toned rows
 * (Dawn/Battery/Weather/Connection/Max duration). The real
 * `check_night_guardrails` returns a flat `{proceed, action, reasons[],
 * hard_stops[]}` instead — no per-check id, label or tone to render as five
 * dotted rows. Inventing that structure (splitting `reasons` into five
 * guessed categories, or assigning each a tone this client made up) would be
 * exactly the derived-assessment problem this project avoids elsewhere, so
 * this card renders the real shape: one overall dot for `action`/`proceed`
 * (the server's own verdict, the same way `assess_conditions.go` drives
 * VerdictBanner), `hard_stops` as the blocking reasons (shown first, with
 * more weight — these are what would actually trigger a park), and the rest
 * of `reasons` underneath as supporting context, exactly as returned.
 *
 * "The rest" is literal: the server builds `reasons = hard_stops + reasons`
 * (seestar-mcp planning/autonomous.py), so every hard stop is also at the
 * head of `reasons`, and rendering both lists verbatim showed each blocking
 * reason twice. See `contextReasons`.
 */
export function GuardrailsCard({ guardrails }: GuardrailsCardProps) {
  const context = guardrails ? contextReasons(guardrails.reasons, guardrails.hard_stops) : []
  const tone: DotTone | undefined = guardrails
    ? guardrails.proceed
      ? 'pass'
      : 'reject'
    : undefined

  return (
    <section className={styles.card}>
      <div className={styles.eyebrow}>check_night_guardrails</div>

      {guardrails ? (
        <>
          <div className={styles.verdictRow}>
            <Dot tone={tone ?? 'idle'} size="sm" />
            <span className={tone === 'pass' ? styles.verdictContinue : styles.verdictPark}>
              {guardrails.action}
            </span>
          </div>

          {guardrails.hard_stops.length > 0 && (
            <ul className={styles.hardStops}>
              {guardrails.hard_stops.map((stop) => (
                <li key={stop} className={styles.hardStop}>
                  {stop}
                </li>
              ))}
            </ul>
          )}

          {context.length > 0 && (
            <ul className={styles.reasons}>
              {context.map((reason, i) => (
                <li key={`${i}-${reason}`} className={styles.reason}>
                  {reason}
                </li>
              ))}
            </ul>
          )}

          {guardrails.reasons.length === 0 && guardrails.hard_stops.length === 0 && (
            <div className={styles.empty}>No guardrail conditions reported this poll.</div>
          )}
        </>
      ) : (
        <div className={styles.empty}>Guardrail status unavailable this poll.</div>
      )}
    </section>
  )
}

/** `reasons` with the hard stops taken out, one occurrence per hard stop —
 * a multiset difference, so a reason that genuinely appears twice keeps its
 * second copy. Order is preserved; nothing is re-worded or re-ranked. */
function contextReasons(reasons: string[], hardStops: string[]): string[] {
  const pending = new Map<string, number>()
  for (const stop of hardStops) pending.set(stop, (pending.get(stop) ?? 0) + 1)
  return reasons.filter((reason) => {
    const left = pending.get(reason) ?? 0
    if (left === 0) return true
    pending.set(reason, left - 1)
    return false
  })
}
