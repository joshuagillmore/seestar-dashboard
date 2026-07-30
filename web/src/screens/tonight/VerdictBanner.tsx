import type { Conditions } from '../../api/schemas'
import { verdictFor, verdictTone } from '../../api/verdict'
import styles from './VerdictBanner.module.css'

const SPINE = { pass: styles.spinePass, reject: styles.spineReject, marginal: styles.spineMarginal } as const
const WORD = { pass: styles.wordPass, reject: styles.wordReject, marginal: styles.wordMarginal } as const
const STAT_TONE = { pass: styles.statPass, marginal: styles.statMarginal, reject: styles.statReject } as const

/**
 * `_dew_risk` on the server returns exactly four strings: high (spread < 2 deg
 * C), moderate (< 5 deg C), low (>= 5 deg C), or "unknown" from the
 * weather-outage fallback. Mapping that closed categorical to a tone is a 1:1
 * relabel, not a derivation — the cutoffs themselves stay server-side. Any
 * value this map doesn't recognise (today, just "unknown") falls through to
 * `undefined` and renders uncoloured, honestly, rather than guessing a tone.
 */
const DEW_TONE: Partial<Record<string, 'pass' | 'marginal' | 'reject'>> = {
  low: 'pass',
  moderate: 'marginal',
  high: 'reject',
}

/** Round, don't truncate: the recorded moon is 0.9877, which is 99% not 98%. */
const pct = (fraction: number) => `${Math.round(fraction * 100)}%`

function Stat({ id, label, value, tone, absentTitle }: {
  id: string
  label: string
  value: string | null
  tone?: 'pass' | 'marginal' | 'reject'
  /** Why THIS stat is showing an em-dash. There is more than one reason a
   * value can be absent — never returned at all, missing during an outage, or
   * suppressed by the UI for provenance — and each caller must say which. */
  absentTitle?: string
}) {
  const absent = value === null
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <div
        data-testid={`stat-${id}`}
        // Mirrors Dot's data-dot: a CSS Modules class name is a hashed
        // implementation detail a test shouldn't compare against, so the tone
        // actually applied is also exposed as a plain attribute.
        data-tone={!absent ? tone : undefined}
        className={`${styles.statValue} ${absent ? styles.statAbsent : ''} ${
          !absent && tone ? STAT_TONE[tone] : ''
        }`}
        title={absent ? absentTitle : undefined}
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
            recorded fixture is a NO-GO with heavy cloud — so every server
            reason is promoted into the body instead of picking one to
            summarize. On a NO-GO, the reasons are the actionable content. */}
        <ul className={styles.reasons}>
          {conditions.reasons.map((reason) => (
            <li key={reason} className={styles.reason}>{reason}</li>
          ))}
        </ul>
        {/* location.warning is NOT rendered here. Sidebar has the dedicated GPS
            status row (a Dot in the matching tone plus this same string) —
            this installation's warning is always populated, so rendering it in
            both places printed it twice on every load. This body's slot is now
            fully occupied by the promoted reasons[] list above. */}
      </div>
      <div className={styles.stats}>
        <Stat id="cloud" label="CLOUD"
          value={conditions.cloud_cover_pct === null ? null : `${Math.round(conditions.cloud_cover_pct)}%`}
          // Unlike PRECIP, cloud cover IS normally returned by assess_conditions
          // — null here means a weather-source outage for this call, not a gap
          // in the tool surface.
          absentTitle="cloud cover unavailable — weather source outage this call" />
        {/* PRECIP tile removed 2026-07-29: precipitation is scored server-side
            and gates `go`, but is not a returned field — it appears only as
            prose inside reasons[] (e.g. "precipitation probability up to
            65%"), rendered right above in .reasons. A tile permanently pinned
            to an em-dash next to a stated percentage read as broken, not
            principled, and parsing the number out of reasons[] would put
            server logic in the UI. Bring the tile back when handback item 3
            lands (max_precip_pct on ConditionsAssessment) — see
            docs/handback-to-seestar-ai.md item 3. */}
        <Stat id="moon" label="MOON"
          value={unknown ? null : pct(conditions.moon_illum_frac)}
          // The server DID return moon_illum_frac (0.0, from the outage
          // fallback) — this is the UI declining to show it, not the server
          // withholding it. Blaming the server here would be false.
          absentTitle="suppressed by the UI during a weather outage — the server's fallback returns 0%, not a measured value" />
        <Stat id="dew" label="DEW" value={conditions.dew_risk}
          tone={DEW_TONE[conditions.dew_risk]} />
      </div>
    </section>
  )
}
