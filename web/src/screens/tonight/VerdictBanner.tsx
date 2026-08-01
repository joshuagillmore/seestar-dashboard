import type { Conditions } from '../../api/schemas'
import { dewRiskTone, verdictFor, verdictTone } from '../../api/verdict'
import { Dot } from '../../ui/Dot'
import styles from './VerdictBanner.module.css'

const SPINE = { pass: styles.spinePass, reject: styles.spineReject, marginal: styles.spineMarginal } as const
const WORD = { pass: styles.wordPass, reject: styles.wordReject, marginal: styles.wordMarginal } as const
const FACT_TONE = { pass: styles.factPass, marginal: styles.factMarginal, reject: styles.factReject } as const

/** Round, don't truncate — a fraction like 0.995 should read 100%, not 99%.
 *  (Illustrative only: pinning this to today's recorded moon value would make
 *  the comment wrong again the next time the fixture is re-recorded.) */
const pct = (fraction: number) => `${Math.round(fraction * 100)}%`

/**
 * One fact in the compact row below the headline. Structured fields only —
 * see the module doc comment below for why PRECIP has no fact here and won't
 * until handback item 3 lands. A null value drops the fact entirely: no
 * placeholder, no "null", nothing occupying the slot. That's different from
 * the bordered Stat tiles this replaced, which rendered an explicit em-dash
 * for an absent value — an em-dash filling a fixed-width box reads as
 * "measured and empty"; a running line of facts has no box to fill, so a
 * missing fact should just not be there.
 */
function Fact({ id, label, value, tone }: {
  id: string
  label: string
  value: string | null
  tone?: 'pass' | 'marginal' | 'reject'
}) {
  if (value === null) return null
  return (
    <span
      data-testid={`fact-${id}`}
      data-tone={tone}
      className={`${styles.fact} ${tone ? FACT_TONE[tone] : ''}`}
    >
      {label} {value}
    </span>
  )
}

/**
 * The hybrid banner shape the user picked over both the design's single
 * prose sentence and the all-reasons-as-bullets layout this replaces:
 *
 *   NO-GO   |  <headline sentence, only once the server sends one>
 *   verdict |  cloud 85%   dew high   wind 7 kph   moon 100%
 *           |  ● GPS unverified — assuming saved site 'Example Observatory'
 *
 * The headline is a slot, not a composition: `conditions.summary` renders
 * verbatim when present and nothing renders in its place otherwise. This
 * dashboard does not write its own verdict summary — deciding which factor
 * mattered most on a given night is server-owned policy, the same as QA
 * verdicts and thresholds. See docs/handback-to-seestar-ai.md item 13, which
 * is what asks the server for `summary: str`.
 *
 * Until that lands, the fact row (built only from structured fields, never
 * parsed out of `reasons[]` prose) is the primary content, and the full
 * `reasons[]` list still renders beneath it, quieter than before — it is the
 * only explanation of the verdict the user has right now. Once `summary`
 * exists the reasons list collapses: the headline already names what
 * mattered, and repeating all five equally-weighted lines under a sentence
 * that says which one was decisive would undercut the sentence.
 */
export function VerdictBanner({ conditions }: { conditions: Conditions }) {
  const verdict = verdictFor(conditions.go)
  const tone = verdictTone(verdict)
  // On a weather outage the server's _unknown() fallback zeroes moon_illum_frac
  // rather than nulling it (weather.py:166). Rendering "MOON 0%" there would be
  // a fabricated measurement, so UNKNOWN forces it absent. dew_risk needs no
  // such guard — the server sets the honest string "unknown", which the fact
  // row shows as-is rather than dropping (it's a real value, not a null one).
  const unknown = verdict === 'UNKNOWN'
  const headline = conditions.summary ?? null
  const warning = conditions.location.warning ?? null

  return (
    <section className={styles.card}>
      <div className={`${styles.spine} ${SPINE[tone]}`} />
      <div>
        <div className={`${styles.word} ${WORD[tone]}`}>{verdict}</div>
        <div className={styles.caption}>verdict</div>
      </div>
      <div className={styles.divider} />
      <div className={styles.body}>
        {headline && <p className={styles.headline}>{headline}</p>}

        <div className={styles.facts} data-testid="fact-row">
          <Fact
            id="cloud"
            label="cloud"
            value={conditions.cloud_cover_pct === null ? null : `${Math.round(conditions.cloud_cover_pct)}%`}
          />
          {/* PRECIP has no fact here: precipitation is scored server-side and
              gates `go`, but is not a returned field — it appears only as
              prose inside reasons[] (e.g. "precipitation probability up to
              65%"), and parsing that number back out would put server logic
              in the UI. Bring it back when handback item 3 lands
              (max_precip_pct on ConditionsAssessment) — see
              docs/handback-to-seestar-ai.md item 3. */}
          <Fact id="dew" label="dew" value={conditions.dew_risk} tone={dewRiskTone(conditions.dew_risk)} />
          <Fact
            id="wind"
            label="wind"
            value={conditions.wind_kph === null ? null : `${Math.round(conditions.wind_kph)} kph`}
          />
          <Fact
            id="moon"
            label="moon"
            // The server DID return moon_illum_frac (0.0, from the outage
            // fallback) on an outage — this is the UI declining to show it,
            // not the server withholding it.
            value={unknown ? null : `${pct(conditions.moon_illum_frac)} lit`}
          />
        </div>

        {!headline && (
          <ul className={styles.reasons}>
            {conditions.reasons.map((reason) => (
              <li key={reason} className={styles.reason}>{reason}</li>
            ))}
          </ul>
        )}

        {/* Moved in from Sidebar's site block (design README.md:265-280 puts
            the GPS row in the banner, not the sidebar) — Sidebar still has
            its own copy for now (VerdictBanner and Sidebar are populated from
            the same `conditions.location`/`gpsWarning` source but neither
            imports the other), which is a deliberate double-render pending a
            shell-side removal, not an oversight. */}
        <div className={warning ? styles.gpsWarn : styles.gpsOk}>
          <Dot tone={warning ? 'marginal' : 'pass'} size="sm" />
          <span>{warning ?? 'GPS matched'}</span>
        </div>
      </div>
    </section>
  )
}
