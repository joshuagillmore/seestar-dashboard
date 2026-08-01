import { useCallback, useEffect, useRef, useState } from 'react'

import { fetchQaStatus, fetchQaTargets, startQaAnalysis } from '../../api/client'
import type { QaAnalysisResponse, QaTargets } from '../../api/schemas'

/** How often to re-poll a running job. `qa_tier2` takes minutes over a real
 * target, so this is deliberately slow: the sidecar route reads an in-memory
 * registry and a disk cache, but the archive scan behind it is not free. */
const POLL_MS = 4000

export type ReviewPhase = 'loading' | 'ready' | 'error'

export interface QaReviewState {
  phase: ReviewPhase
  targets: QaTargets | null
  /** The target the user selected, or null before they pick one. */
  selected: string | null
  status: QaAnalysisResponse | null
  /** True only between the click and the first status response — the button's
   * own pending state, distinct from a job actually running. */
  starting: boolean
  error: string | null
  select: (targetId: string) => void
  analyse: () => void
}

/**
 * Data for the Review & QA screen.
 *
 * The load discipline is the whole point of this hook, and it comes from
 * CLAUDE.md and the slice-4 spec: **an analysis is never started by a page
 * load.** `qa_tier2` is minutes long over 200–1400 subs. So:
 *
 *   - mount fetches `/api/qa_targets` only — a listing with per-target status
 *     and sub counts, no reports, and it can never start a job;
 *   - selecting a target fetches that target's status, which may already be
 *     `complete` from the on-disk cache. Still never starts anything;
 *   - `analyse()` is the only path to `/api/qa_analysis_start`, and it exists
 *     solely to be called from a click.
 *
 * Polling stops the moment a job is not running, so an idle screen left open
 * overnight is not quietly hitting the sidecar — the mistake we made on the
 * Live screen's idle path and still owe seestar-mcp a fix for.
 */
export function useQaReview(): QaReviewState {
  const [targets, setTargets] = useState<QaTargets | null>(null)
  const [phase, setPhase] = useState<ReviewPhase>('loading')
  const [selected, setSelected] = useState<string | null>(null)
  const [status, setStatus] = useState<QaAnalysisResponse | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Guards a late response from a target the user has already navigated away
  // from overwriting the current one.
  const currentTarget = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchQaTargets()
      .then((data) => {
        if (cancelled) return
        setTargets(data)
        setPhase('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setPhase('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const select = useCallback((targetId: string) => {
    currentTarget.current = targetId
    setSelected(targetId)
    setStatus(null)
    setError(null)
    // Reads status only. A cached report comes back immediately; an
    // unanalysed target comes back `not_analysed` and stays that way until
    // the user asks for a run.
    fetchQaStatus(targetId)
      .then((data) => {
        if (currentTarget.current !== targetId) return
        setStatus(data)
      })
      .catch((err: unknown) => {
        if (currentTarget.current !== targetId) return
        setError(err instanceof Error ? err.message : String(err))
      })
  }, [])

  const analyse = useCallback(() => {
    const target = currentTarget.current
    if (target == null) return
    setStarting(true)
    setError(null)
    startQaAnalysis(target)
      .then((data) => {
        if (currentTarget.current !== target) return
        setStatus(data)
      })
      .catch((err: unknown) => {
        if (currentTarget.current !== target) return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (currentTarget.current === target) setStarting(false)
      })
  }, [])

  /**
   * Keep the target list in step with the status we just fetched.
   *
   * The list is fetched once on mount and never again — `/api/qa_targets`
   * re-scans the whole archive, so re-running it on every poll would be a
   * real cost for one row's worth of change. That left a bug: a target
   * analysed during this visit kept saying "not analysed" in the list while
   * its finished report rendered beside it, because the row still held what
   * it had at page load. Only a page reload agreed with itself.
   *
   * Patched from the status response we already have rather than refetched.
   * `display_name` and `sub_count` come from the row (the status route's
   * `sub_count` agrees, but the row is the authority for the label), and the
   * status fields replace the stale ones — so a row goes not_analysed →
   * running → complete as the poll sees it happen.
   */
  useEffect(() => {
    if (status == null || selected == null) return
    setTargets((prev) => {
      if (prev == null) return prev
      const i = prev.targets.findIndex((t) => t.target_id === selected)
      if (i === -1) return prev
      const row = prev.targets[i]!
      if (row.status === status.status) return prev // no churn on every poll
      const { ok: _ok, target_id: _tid, sub_count: _sc, ...statusFields } = status
      const next = [...prev.targets]
      next[i] = { ...row, ...statusFields } as (typeof prev.targets)[number]
      return { ...prev, targets: next }
    })
  }, [status, selected])

  // Poll ONLY while a job is actually running. No running job, no timer.
  useEffect(() => {
    if (status?.status !== 'running' || selected == null) return undefined

    const id = window.setInterval(() => {
      fetchQaStatus(selected)
        .then((data) => {
          if (currentTarget.current !== selected) return
          setStatus(data)
        })
        .catch(() => {
          /* A failed poll is not fatal — the next one may succeed, and the
             card keeps showing "running" rather than flipping to an error
             the job itself has not reported. */
        })
    }, POLL_MS)

    return () => window.clearInterval(id)
  }, [status?.status, selected])

  return { phase, targets, selected, status, starting, error, select, analyse }
}
