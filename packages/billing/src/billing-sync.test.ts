import { describe, expect, it } from 'vite-plus/test'

import { reconcileWorkspaceBudget } from './billing-sync.live.ts'

describe('reconcileWorkspaceBudget', () => {
  it('keeps a workspace slot when unresolved evidence takes the whole pass', () => {
    // `limit(0)` selects nothing, so a full page of retryable evidence would
    // otherwise stall every workspace behind it.
    expect(reconcileWorkspaceBudget(5, 5)).toBe(1)
    expect(reconcileWorkspaceBudget(5, 9)).toBe(1)
  })

  it('leaves the remaining budget to workspaces', () => {
    expect(reconcileWorkspaceBudget(10, 3)).toBe(7)
    expect(reconcileWorkspaceBudget(10, 0)).toBe(10)
  })
})
