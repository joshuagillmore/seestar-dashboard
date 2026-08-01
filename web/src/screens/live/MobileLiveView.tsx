import type { FocuserPosition, LivePreview, StackState, Tier1 } from '../../api/schemas'
import { Dot } from '../../ui/Dot'
import { livePreviewImageSrc } from './livePreviewImage'
import { deriveTelemetryValues, formatAnnotateState } from './telemetryFormatting'
import { TelemetryLogCard } from './TelemetryLogCard'
import type { TelemetryEntry } from './telemetryLog'
import styles from './MobileLiveView.module.css'

export interface MobileLiveViewProps {
  /** Catalogue id — `get_target_observability`'s own `target.id` once it
   * resolves, falling back to the id `useLiveSession` sourced from the
   * live-preview share's `target` field before that (same fallback
   * TargetHeader uses, named `currentTarget` there — see LiveScreen.tsx). */
  targetId: string | null
  /** Common name — only present once `get_target_observability` resolves;
   * `null` renders no subtitle rather than repeating the id. Design
   * README.md:701 shows both ("SH2-142" big, "Wizard Nebula" as a subtitle)
   * — real fields on `ObservabilityTarget`, not invented for mobile. */
  targetName: string | null
  stack: StackState | null
  tier1: Tier1 | null
  focuser: FocuserPosition | null
  preview: LivePreview | null
  log: TelemetryEntry[]
}

/**
 * Mobile — Live (design README.md:698–711), the phone-frame composition for
 * the 'active' phase only — LiveScreen.tsx renders this instead of the
 * desktop three-column layout when `useMediaQuery(MOBILE_QUERY)` matches.
 * Three things the design shows that this component deliberately does not:
 *
 * 1. **The decision card** (`Approve slew` / `Not yet`) — dropped entirely,
 *    not disabled. It's the deferred approval gate; every control it would
 *    need maps to a write tool the sidecar's allowlist excludes, the same
 *    ruling desktop's TargetHeader button row and PlanCard's primary action
 *    already made (slice-3 spec §0). Not a placeholder card, nothing.
 *
 * 2. **Filter chip / exposure / elapsed** in the header subtitle, and the
 *    "· 71.3 min" integration caption beside the stacked count — both need
 *    fields no confirmed tool returns (live filter state: handback items
 *    5/14; exposure length actually running: TelemetryGrid's own
 *    INTEGRATION cell; session start / elapsed: handback item 20). Desktop's
 *    TargetHeader already drops all three for the same reason — this just
 *    doesn't reintroduce them for mobile.
 *
 * 3. **ALT and BAND stat tiles** — both need an instantaneous current
 *    altitude the tool surface does not return (`get_target_observability`
 *    is the *nightly* aggregate; see SweetBandGauge's own doc comment and
 *    handback item 18). Rather than rendering two placeholder tiles beside
 *    DROPS, this keeps the three-tile row but fills it with three real
 *    numbers instead: DROPS, FOCUS and PLATE SOLVE — the same values
 *    TelemetryGrid's desktop cells show, via the same shared
 *    `deriveTelemetryValues` (not recomputed separately, so the two
 *    screens can't disagree). All three answer the question a phone
 *    glance actually needs at field density — "is the session healthy" —
 *    which DROPS alone doesn't.
 *
 * The preview keeps the two dishonesty guards PreviewCard enforces
 * (a `source: "sub"` frame is a single noisy sub, not the stack; `stale` is
 * shown with when the frame is actually from) but drops the overlay toggle
 * and framing-readout footer — the design's mobile preview is a plain
 * cropped image with no controls, and there's no room to add them back.
 */
export function MobileLiveView({ targetId, targetName, stack, tier1, focuser, preview, log }: MobileLiveViewProps) {
  const { stackedValue, droppedValue, droppedPctValue, focusValue, annotateState, solveTone } =
    deriveTelemetryValues(stack, tier1, focuser)

  const imageSrc = livePreviewImageSrc(preview)
  // Keyed on `source`, not `url` — the same defect PreviewCard had, and for
  // the same reason. `url` is a static route path that routes.py's
  // `_live_preview_absent()` sets unconditionally, so it is present even when
  // there is no frame; guarding on it renders an <img> at a URL that 404s.
  // Both components passed their tests because the no-frame fixture omitted
  // `url`, which no real response does. Correcting that fixture is what
  // surfaced this second copy.
  const hasImage = Boolean(preview?.source)

  return (
    <div className={styles.root}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <div className={styles.statusRow}>
            <Dot tone="accent" pulse size="sm" />
            <span className={styles.status}>Stacking</span>
          </div>
          <h2 className={styles.targetId}>{targetId ?? 'Target unknown'}</h2>
          {targetName && <div className={styles.targetName}>{targetName}</div>}
        </div>
        <div className={styles.headerRight}>
          <div className={styles.stackedValue}>{stackedValue != null ? stackedValue : '—'}</div>
          <div className={styles.stackedCaption}>stacked</div>
        </div>
      </header>

      <div className={styles.previewWrap}>
        {hasImage ? (
          <>
            <img
              src={imageSrc}
              alt={targetName ? `Live camera view of ${targetName}` : 'Live camera view'}
              className={styles.previewImage}
            />
            <div className={styles.badges}>
              {preview?.source === 'sub' && (
                <span className={styles.badge} data-testid="mobile-preview-source-sub">
                  single 10 s sub — not the stack
                </span>
              )}
              {preview?.stale && (
                <span className={`${styles.badge} ${styles.badgeStale}`} data-testid="mobile-preview-stale">
                  stale
                </span>
              )}
            </div>
          </>
        ) : (
          <div className={styles.previewEmpty} data-testid="mobile-preview-empty">
            {preview?.reason ?? 'No preview available'}
          </div>
        )}
      </div>

      <div className={styles.tiles} data-testid="mobile-live-tiles">
        <div className={styles.tile}>
          <div className={styles.tileLabel}>DROPS</div>
          <div className={styles.tileValue}>{droppedValue != null ? droppedValue : '—'}</div>
          {droppedPctValue !== null && (
            <div className={styles.tileSub}>{droppedPctValue.toFixed(1)}% of frames</div>
          )}
        </div>
        <div className={styles.tile}>
          <div className={styles.tileLabel}>FOCUS</div>
          <div className={styles.tileValue}>{focusValue != null ? focusValue : '—'}</div>
        </div>
        <div className={styles.tile}>
          <div className={styles.tileLabel}>PLATE SOLVE</div>
          <div className={`${styles.tileValue} ${solveTone ? styles[solveTone] : ''}`}>
            {formatAnnotateState(annotateState)}
          </div>
        </div>
      </div>

      <TelemetryLogCard log={log} limit={3} compact />
    </div>
  )
}
