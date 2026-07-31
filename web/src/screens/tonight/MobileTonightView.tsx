import type { Conditions, PlanTarget, SiteProfile } from '../../api/schemas'
import { dewRiskTone, verdictFor, verdictTone } from '../../api/verdict'
import { TargetThumb } from '../../ui/TargetThumb'
import { shortlistOrderLabel } from './shortlist'
import { localHhMm, parse, zoneLabel } from './timeline'
import styles from './MobileTonightView.module.css'

const VERDICT_TONE_CLASS = { pass: styles.pass, marginal: styles.marginal, reject: styles.reject } as const
const TILE_TONE_CLASS = { pass: styles.pass, marginal: styles.marginal, reject: styles.reject } as const

/** Design shows exactly three rows (SH2-142/M31/M45, README.md:717-719) — a
 * deliberate field-density cap, not a bug: the full ranked shortlist is
 * already on desktop Tonight, and a phone glance wants the top few options,
 * not all twelve. */
const SHORTLIST_ROWS = 3

export interface MobileTonightViewProps {
  conditions: Conditions
  targets: PlanTarget[]
  site: SiteProfile | null
}

/**
 * Mobile — Tonight (design README.md:712–722). Rendered by TonightScreen.tsx
 * in place of the desktop VerdictBanner/SweetBandTimeline/PlanCard-grid
 * composition once `useMediaQuery(MOBILE_QUERY)` matches.
 *
 * Two deliberate departures from the design mockup's literal text, both
 * following precedent already set elsewhere in this codebase:
 *
 * - The eyebrow's site name is the real `site.profile.name` ("Example Observatory (scope
 *   GPS)"), not the design's illustrative "Backyard" — the mockup's example
 *   value, not a literal string this client should reproduce (the same
 *   relationship the recorded fixture always has to the design's other
 *   worked examples, e.g. SH2-142/M31/M45 below being illustrative ids, not
 *   a hardcoded chain).
 * - The prose beside the verdict word renders `conditions.summary` verbatim
 *   when the server sends one, and renders nothing in its place otherwise —
 *   it does NOT compose a sentence from cloud/dark-window/moon figures the
 *   way the design's example text reads. That's exactly the derived-verdict
 *   problem VerdictBanner's own doc comment describes: deciding which factor
 *   to foreground in one sentence is server-owned policy (handback item 13
 *   is what would ship a real `summary`), and picking a single `reasons[]`
 *   entry to feature here would have the same problem by another route —
 *   it would read as "the decisive reason" when nothing has actually ranked
 *   the reasons against each other.
 *
 * The design's footer note is one sentence ("Order: SH2-142 → M31 → M45
 * (earliest-setting first, 2 slews). NGC 7000 dropped — behind horizon
 * mask.") built from two independent facts with different provenance. Only
 * the second — which targets the ranker dropped, and why — needs
 * excluded-target data no tool returns (handback item 4), so only that half
 * is omitted. The order clause is real, already computed, and shared
 * verbatim with desktop via `shortlistOrderLabel` (see ./shortlist) rather
 * than recomposed — it happens to already cap at three ids with `+N more`,
 * which suits a phone better than the desktop grid it was built for. On a
 * NO-GO night it is replaced by the same "ranked for reference" caption
 * desktop shows, for the same reason: a stated slew order reads as a plan,
 * which a no-go night is not.
 */
export function MobileTonightView({ conditions, targets, site }: MobileTonightViewProps) {
  const verdict = verdictFor(conditions.go)
  const tone = verdictTone(verdict)
  const dewTone = dewRiskTone(conditions.dew_risk)
  const [darkStart, darkEnd] = conditions.dark_window_utc
  const dateLabel = new Date().toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
  const siteName = site?.profile.name ?? null
  const shortlist = targets.slice(0, SHORTLIST_ROWS)

  return (
    <div className={styles.root}>
      <div className={styles.eyebrow}>
        {dateLabel}
        {siteName ? ` · ${siteName}` : ''}
      </div>

      <div className={styles.verdictRow}>
        <span className={`${styles.verdict} ${VERDICT_TONE_CLASS[tone]}`}>{verdict}</span>
        {conditions.summary && <p className={styles.summary}>{conditions.summary}</p>}
      </div>

      <div className={styles.tiles}>
        <div className={styles.tile}>
          <div className={styles.tileLabel}>DARK WINDOW</div>
          <div
            className={styles.tileValue}
            title="Browser-local clock time — may not match the observing site's zone."
          >
            {localHhMm(parse(darkStart))} → {localHhMm(parse(darkEnd))}
          </div>
        </div>
        <div className={styles.tile}>
          <div className={styles.tileLabel}>DEW RISK</div>
          <div className={`${styles.tileValue} ${dewTone ? TILE_TONE_CLASS[dewTone] : ''}`}>
            {conditions.dew_risk}
          </div>
        </div>
      </div>

      <div className={styles.shortlistEyebrow}>Ranked shortlist</div>

      {shortlist.length > 0 ? (
        <>
          <div className={styles.rows} data-testid="mobile-shortlist">
            {shortlist.map((target) => (
              <MobileShortlistRow key={target.id} target={target} />
            ))}
          </div>
          {/* Full `targets`, not the capped `shortlist` — the slew count is
              `targets.length - 1` over the whole plan, not just the three
              rows shown above (see shortlistOrderLabel's own doc comment). */}
          {verdict === 'NO-GO' ? (
            <div className={styles.footer}>Ranked for reference — tonight is a no-go.</div>
          ) : (
            <div className={styles.footer}>{shortlistOrderLabel(targets)}</div>
          )}
        </>
      ) : (
        <div className={styles.empty}>No target clears the sweet band tonight.</div>
      )}
    </div>
  )
}

function MobileShortlistRow({ target }: { target: PlanTarget }) {
  const [from, to] = target.best_window_utc
  return (
    <div className={styles.row} data-testid="mobile-shortlist-row">
      <TargetThumb image={target.image} alt={target.name} className={styles.thumb} />
      <div className={styles.rowBody}>
        <div className={styles.rowName}>{target.name}</div>
        <div className={styles.rowMeta} title={`Local clock, ${zoneLabel(parse(from))}`}>
          {localHhMm(parse(from))}–{localHhMm(parse(to))} · {target.recommended_subs} subs
        </div>
      </div>
      <div className={styles.rowScore}>{target.score}</div>
    </div>
  )
}
