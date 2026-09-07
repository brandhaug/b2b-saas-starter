import { Effect, Layer } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import { SeedWorkspaceSuspension } from './workspace-suspension.seed.ts'
import { workspaceSuspensionContractCases } from './workspace-suspension.contract.ts'
import { AuditEventLog } from './audit-event-log.ts'
import { NotificationFeed } from '../notifications/notification-feed.ts'

const layer = SeedWorkspaceSuspension({
  workspace: {
    id: 'wrk_live',
    slug: 'live-lab',
    name: 'Live Lab',
    planId: 'starter'
  },
  systemUsers: [
    {
      id: 'usr_sysadmin',
      name: 'System Admin',
      email: 'admin@test',
      systemRole: 'admin',
      banned: false
    },
    {
      id: 'usr_owner',
      name: 'Owner',
      email: 'owner@test',
      systemRole: 'user',
      banned: false
    }
  ]
}).pipe(
  Layer.provide(Layer.mock(AuditEventLog, { record: () => Effect.void })),
  Layer.provide(
    Layer.mock(NotificationFeed, { notifyWorkspaceOwners: () => Effect.void })
  )
)

describe('seed workspace suspension', () => {
  for (const testCase of workspaceSuspensionContractCases(expect)) {
    it.effect(testCase.name, () => testCase.assert.pipe(Effect.provide(layer)))
  }
})
