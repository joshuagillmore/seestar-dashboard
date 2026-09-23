import { subImageSrc } from '../../api/client'
import type { QaSubVerdict } from '../../api/schemas'
import { formatMetric, isUnanalysed, measuredValue, METRIC_LABELS, toneFor } from './qa'
import styles from './SubImageCard.module.css'

export interface SubImageCardProps {
  targetId: string
  sub: QaSubVerdict
  onClose: () => void
}

const METRICS = ['fwhm', 'eccentricity', 'snr', 'star_count', 'scattered_light', 'hfr'] as const

/**
 * One sub, looked at rather than only read.
 *
 * The image is the Seestar's own `<stem>_thn.jpg`, which it writes beside
 * every captured sub — verified across the whole archive, 7,533 subs and
 * 7,533 thumbnails. That is why this needs no FITS decoding in the browser
 * and no handing a path to the OS to open: the picture already exists, at
 * ~15–20 KB, and the sidecar serves it from the archive scan's own file list.
 *
 * It is a THUMBNAIL and says so. At roughly 250 px it is enough to see what a
 * verdict is talking about — trailing, cloud, a bright-star halo — and not
 * enough to judge fine focus. Labelling it prevents someone reading softness
 * in the thumbnail as softness in the sub.
 *
 * The verdict and reasons repeat here rather than being left to the row: this
 * card is what someone looks at while deciding whether they agree with the
 * server, and the justification has to be next to the evidence.
 */
export function SubImageCard({ targetId, sub, onClose }: SubImageCardProps) {
  const tone = toneFor(sub.verdict)
  const unanalysed = isUnanalysed(sub)

  return (
    <div className={styles.card} data-testid="sub-image-card">
      <div className={styles.head}>
        <div className={styles.titleGroup}>
          <span className={`${styles.badge} ${styles[unanalysed ? 'unanalysed' : tone]}`}>
            {unanalysed ? 'NOT ANALYSED' : sub.verdict}
          </span>
          <span className={styles.name} title={sub.name}>
            {sub.name}
          </span>
        </div>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close sub preview">
          ×
        </button>
      </div>

      <div className={styles.body}>
        <div className={styles.imageWrap}>
          <img
            className={styles.image}
            src={subImageSrc(targetId, sub.name)}
            alt={`Camera thumbnail for ${sub.name}`}
          />
          <div className={styles.imageNote}>
            the scope&rsquo;s own thumbnail — enough to see trailing or cloud, not fine focus
          </div>
        </div>

        <div className={styles.detail}>
          <dl className={styles.metrics}>
            {METRICS.map((key) => (
              <div key={key} className={styles.metric}>
                <dt>{METRIC_LABELS[key] ?? key}</dt>
                <dd>
                  {/* A dash, not the 0 the server sends as star_count for
                      a sub it could not analyse — see measuredValue. */}
                  {formatMetric(
                    measuredValue(sub, key),
                    key === 'star_count' ? 0 : key === 'scattered_light' ? 4 : 2,
                  )}
                </dd>
              </div>
            ))}
          </dl>

          {/* The server's own sentences, verbatim — the audit trail the QA
              policy requires, shown beside the frame it is about. */}
          {unanalysed ? (
            <p className={styles.reason}>{sub.metrics.error}</p>
          ) : sub.reasons.length > 0 ? (
            <ul className={styles.reasons}>
              {sub.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          ) : (
            <p className={styles.reason}>Clears every gate.</p>
          )}
        </div>
      </div>
    </div>
  )
}
