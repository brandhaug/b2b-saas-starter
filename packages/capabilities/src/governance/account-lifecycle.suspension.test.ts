import { describe, expect, it } from 'vite-plus/test'
import { planAccountDeletion } from './account-lifecycle.ts'

describe('account deletion and suspended workspaces', () => {
  it('does not indirectly delete a suspended workspace', () => {
    const plan = planAccountDeletion([
      {
        workspace: {
          id: 'wrk_suspended',
          slug: 'suspended-lab',
          name: 'Suspended Lab',
          planId: 'starter'
        },
        memberId: 'mem_owner',
        role: 'owner',
        ownerCount: 1,
        memberCount: 1,
        suspended: true
      }
    ])
    expect(plan.canDelete).toBe(false)
    expect(plan.steps[0]?.action).toBe('blocked_suspended_workspace')
  })
})
