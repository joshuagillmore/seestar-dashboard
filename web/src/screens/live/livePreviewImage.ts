import type { LivePreview } from '../../api/schemas'

/**
 * The sidecar's `/api/live_preview/image` URL is always the same literal path
 * (routes.py's `_live_preview_frame`/`_live_preview_absent` both return
 * "/api/live_preview/image", never a per-frame path) — the bytes behind it
 * change every poll, but the URL string does not. Without a cache-buster the
 * browser is free to serve the very first frame it ever fetched for the
 * lifetime of the tab, silently defeating "live". Since `captured_at`
 * genuinely changes every time a new frame is found, it is the real signal a
 * query param can ride on — not an invented one.
 *
 * Shared by PreviewCard (desktop) and MobileLiveView so the two compositions
 * — which render very different markup around the image — don't compute this
 * differently.
 */
export function livePreviewImageSrc(preview: LivePreview | null): string | undefined {
  if (!preview?.url) return preview?.url ?? undefined
  return preview.captured_at
    ? `${preview.url}?t=${encodeURIComponent(preview.captured_at)}`
    : preview.url
}
