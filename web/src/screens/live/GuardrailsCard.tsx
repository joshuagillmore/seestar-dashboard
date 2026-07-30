import type { Guardrails } from '../../api/schemas'
import { Dot } from '../../ui/Dot'
import styles from './GuardrailsCard.module.css'

export interface GuardrailsCardProps {
  /** `null` on fetch failure — degrades to an absent card, not a crash; see
   * useLiveSession's per-endpoint soft-fail. */
  guardrails: Guardrails | null
}

/**
 * design README.md:448-461. Every row's dot tone and the closing verdict
 * come from the server verbatim — this card never computes a check's own
 * pass/marginal/reject, the same rule QA verdicts and the conditions
 * verdict already follow elsewhere in this app.
 */
export function GuardrailsCard({ guardrails }: GuardrailsCardProps) {
  return (
    <section className={styles.card}>
      <div className={styles.eyebrow}>check_night_guardrails</div>

      {guardrails ? (
        <>
          <ul className={styles.rows}>
            {guardrails.checks.map((check) => (
              <li key={check.id} className={styles.row}>
                <Dot tone={check.tone} size="sm" />
                <span className={styles.label}>{check.label}</span>
                <span className={styles.value}>{check.value}</span>
              </li>
            ))}
          </ul>
          {guardrails.verdict && (
            <div className={styles.footer}>
              Verdict{' '}
              <span className={guardrails.verdict === 'continue' ? styles.verdictContinue : styles.verdictPark}>
                {guardrails.verdict}
              </span>{' '}
              — every hard stop ends in park.
            </div>
          )}
        </>
      ) : (
        <div className={styles.empty}>Guardrail status unavailable this poll.</div>
      )}
    </section>
  )
}
