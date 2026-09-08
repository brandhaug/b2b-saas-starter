import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'

import { SeedLayer } from '@b2b-saas-starter/capabilities/layers'
import { seedWorkspaceRecord } from '@b2b-saas-starter/capabilities/seed-fixture'
import { WorkspaceSuspensionService } from '@b2b-saas-starter/capabilities/governance/workspace-suspension'
import {
  testWorkspaceContext,
  type Actor
} from '@b2b-saas-starter/capabilities/workspace-context'

import { workspaceRecoveryPayload } from './workspace-suspension.effects'

function actor(userId: string, role: Actor['role']): Actor {
  return { userId, role, systemRole: 'user' }
}

describe('workspace recovery projection', () => {
  it.effect('returns only recovery data and projects controls by permission', () =>
    Effect.gen(function* () {
      const suspension = yield* WorkspaceSuspensionService
      yield* suspension.transition({
        workspaceId: seedWorkspaceRecord.id,
        action: 'suspend',
        actor: { userId: 'usr_demo' },
        internalReason: 'private operator note',
        customerExplanation: 'Update the payment method or contact support.'
      })

      const owner = yield* workspaceRecoveryPayload.pipe(
        Effect.provide(
          testWorkspaceContext(seedWorkspaceRecord, actor('usr_demo', 'owner'))
        )
      )
      const admin = yield* workspaceRecoveryPayload.pipe(
        Effect.provide(
          testWorkspaceContext(seedWorkspaceRecord, actor('usr_ops', 'admin'))
        )
      )
      const member = yield* workspaceRecoveryPayload.pipe(
        Effect.provide(
          testWorkspaceContext(seedWorkspaceRecord, actor('usr_dev', 'member'))
        )
      )

      expect(owner).toMatchObject({
        status: 'suspended',
        customerExplanation: 'Update the payment method or contact support.',
        canViewExplanation: true,
        canManageBilling: true
      })
      expect(owner.apiTokens).not.toBeNull()
      expect(owner.ssoConnections).not.toBeNull()
      expect(admin.customerExplanation).toBe(
        'Update the payment method or contact support.'
      )
      expect(admin.apiTokens).not.toBeNull()
      expect(admin.ssoConnections).toBeNull()
      expect(member).toMatchObject({
        status: 'suspended',
        customerExplanation: null,
        canViewExplanation: false,
        canManageBilling: false,
        billingConfigured: false,
        apiTokens: null,
        ssoConnections: null
      })
      expect(Object.keys(owner).toSorted()).toEqual([
        'apiTokens',
        'billingConfigured',
        'canManageBilling',
        'canViewExplanation',
        'changedAt',
        'customerExplanation',
        'ssoConnections',
        'status',
        'viewer',
        'workspaceId',
        'workspaceName'
      ])
      expect(JSON.stringify(owner)).not.toContain('private operator note')
    }).pipe(Effect.provide(SeedLayer))
  )
})
