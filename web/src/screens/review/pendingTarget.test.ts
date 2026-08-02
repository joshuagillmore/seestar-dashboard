import { beforeEach, describe, expect, it } from 'vitest'

import { setPendingReviewTarget, takePendingReviewTarget } from './pendingTarget'

beforeEach(() => window.sessionStorage.clear())

describe('pending review target', () => {
  it('carries a target from Projects to Review', () => {
    setPendingReviewTarget('M57')

    expect(takePendingReviewTarget()).toBe('M57')
  })

  it('is consumed once, so returning later does not revive it', () => {
    // Otherwise clicking the nav rail to Review would silently reopen
    // whatever target someone last arrived at from Projects.
    setPendingReviewTarget('M57')
    takePendingReviewTarget()

    expect(takePendingReviewTarget()).toBeNull()
  })

  it('is null when nothing is pending', () => {
    expect(takePendingReviewTarget()).toBeNull()
  })

  it('ignores a stored value that is not a string', () => {
    window.sessionStorage.setItem('seestar.review.pendingTarget', JSON.stringify({ evil: true }))

    expect(takePendingReviewTarget()).toBeNull()
  })

  it('survives unparseable storage rather than throwing', () => {
    window.sessionStorage.setItem('seestar.review.pendingTarget', 'not json')

    expect(takePendingReviewTarget()).toBeNull()
  })
})
