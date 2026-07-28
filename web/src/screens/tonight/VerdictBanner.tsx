import type { Conditions } from '../../api/schemas'
import { verdictFor, verdictTone } from '../../api/verdict'
import styles from './VerdictBanner.module.css'

const SPINE = { pass: styles.spinePass, reject: styles.spineReject, marginal: styles.spineMarginal } as const
const WORD = { pass: styles.wordPass, reject: styles.wordReject, marginal: styles.wordMarginal } as const

/** Round, don't truncate: the recorded moon is 0.9877, which is 99% not 98%. */
const pct = (fraction: number) => `${Math.round(fraction * 100)}%`

function Stat({ id, label, value, tone }: {
  id: string
  label: string
  value: string | null
  tone?: 'pass'
}) {
  const absent = value === null
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <div
        data-testid={`stat-${id}`}
        className={`${styles.statValue} ${absent ? styles.statAbsent : ''} ${
          tone === 'pass' && !absent ? styles.statPass : ''
        }`}
        title={absent ? 'not returned by assess_conditions — see handback item 3' : undefined}
      >
        {value ?? '—'}
      </div>
    </div>
  )
}

export function VerdictBanner({ conditions }: { conditions: Conditions }) {
  const verdict = verdictFor(conditions.go)
  const tone = verdictTone(verdict)
  // On a weather outage the server's _unknown() fallback zeroes moon_illum_frac
  // rather than nulling it (weather.py:166). Rendering "MOON 0%" there would be
  // a fabricated measurement, so UNKNOWN forces it absent. dew_risk needs no
  // such guard — the server sets the honest string "unknown".
  const unknown = verdict === 'UNKNOWN'

  return (
    <section className={styles.card}>
      <div className={`${styles.spine} ${SPINE[tone]}`} />
      <div>
        <div className={`${styles.word} ${WORD[tone]}`}>{verdict}</div>
        <div className={styles.caption}>verdict</div>
      </div>
      <div className={styles.divider} />
      <div className={styles.body}>
        {/* The design's single prose line assumed a GO night ("Clear (6% cloud)
            through the dark window…"). Most real nights are not that — the
            recorded fixture is a 99%-cloud NO-GO — so every server reason is
            promoted into the body instead of picking one to summarize. On a
            NO-GO, the reasons are the actionable content. */}
        <ul className={styles.reasons}>
          {conditions.reasons.map((reason) => (
            <li key={reason} className={styles.reason}>{reason}</li>
          ))}
        </ul>
        {conditions.location.warning && (
          <div className={styles.warning}>{conditions.location.warning}</div>
        )}
      </div>
      <div className={styles.stats}>
        <Stat id="cloud" label="CLOUD"
          value={conditions.cloud_cover_pct === null ? null : `${Math.round(conditions.cloud_cover_pct)}%`} />
        {/* Precipitation is scored on server-side and gates `go`, but is not a
            returned field — it appears only as prose inside reasons[]. Parsing
            it out would put server logic in the UI. See handback item 3. */}
        <Stat id="precip" label="PRECIP" value={null} />
        <Stat id="moon" label="MOON"
          value={unknown ? null : pct(conditions.moon_illum_frac)} />
        <Stat id="dew" label="DEW" value={conditions.dew_risk}
          tone={conditions.dew_risk === 'low' ? 'pass' : undefined} />
      </div>
    </section>
  )
}
