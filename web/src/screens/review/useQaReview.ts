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
