import { SeedAssistantDirectory } from '../assistant/directory.seed.ts'
import { SeedBilling } from '@b2b-saas-starter/billing/billing.seed'
import {
  AuditEventLog as BillingAudit,
  NotificationFeed as BillingNotifications,
  BillingWebhookPublisher
} from '@b2b-saas-starter/billing/ports'
import { Effect, Layer, Ref } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import { SeedWorkspaceSuspension } from './workspace-suspension.seed.ts'
import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import {
  initialWorkspaceSuspensionStatus,
  isSuspendedWorkspace,
  nextWorkspaceSuspensionStatus,
  workspaceSuspensionAuditEvent,
  workspaceSuspensionExplanation,
  WorkspaceSuspensionService
} from './workspace-suspension.ts'
import { type Workspace } from './workspace-identity.ts'
import { workspaceSuspensionContractCases } from './workspace-suspension.contract.ts'
import { AuditEventLog } from './audit-event-log.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { SeedWorkspaceLifecycle, WorkspaceLifecycle } from './workspace-lifecycle.ts'
import { NotificationFeed } from '../notifications/notification-feed.ts'

const options = {
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
} satisfies Parameters<typeof SeedWorkspaceSuspension>[0]

// Declared out of name order on purpose: the ordering contract case only
// proves the adapter sorts if the fixture it reads does not arrive sorted.
const catalogWorkspaces = [
  { id: 'wrk_zeta', slug: 'zeta-lab', name: 'Zeta Lab', planId: 'starter' },
  options.workspace,
  { id: 'wrk_alpha', slug: 'alpha-lab', name: 'Alpha Lab', planId: 'starter' }
]

function makeLayer(feed: Layer.Layer<NotificationFeed>) {
  return Layer.unwrap(
    Effect.gen(function* () {
      const catalog = yield* Ref.make<ReadonlyArray<Workspace>>(catalogWorkspaces)
      return SeedWorkspaceSuspension({ ...options, catalog }).pipe(
        Layer.provide(SeedAssistantDirectory),
        Layer.provide(Layer.mock(AuditEventLog, { record: () => Effect.void })),
        Layer.provide(feed)
      )
    })
  )
}

const layer = makeLayer(
  Layer.mock(NotificationFeed, {
    prepareWorkspaceOwners: () =>
      Effect.succeed({ writes: [], commit: Effect.void, publish: Effect.void })
  })
)

describe('workspace suspension transitions', () => {
  it('moves both directions between active and suspended', () => {
    expect(initialWorkspaceSuspensionStatus).toBe('active')
    expect(nextWorkspaceSuspensionStatus('active', 'suspend')).toBe('suspended')
    expect(nextWorkspaceSuspensionStatus('suspended', 'unsuspend')).toBe('active')
  })

  it('refuses a transition to the current status', () => {
    // The no-op both adapters owe their silence to: no write, no audit, no
    // notice. The assistant_workspace_suspension trigger agrees — it only
    // fires when the stored status actually changed.
    expect(nextWorkspaceSuspensionStatus('active', 'unsuspend')).toBeNull()
    expect(nextWorkspaceSuspensionStatus('suspended', 'suspend')).toBeNull()
  })

  it('keys the audit event and explanation on the committed status', () => {
    expect(workspaceSuspensionAuditEvent('suspended')).toBe('workspace.suspended')
    expect(workspaceSuspensionAuditEvent('active')).toBe('workspace.unsuspended')
    expect(workspaceSuspensionExplanation('suspended', 'Contact support.')).toBe(
      'Contact support.'
    )
    expect(workspaceSuspensionExplanation('active', 'Contact support.')).toBeNull()
    expect(isSuspendedWorkspace('suspended')).toBe(true)
    expect(isSuspendedWorkspace('active')).toBe(false)
  })
})

describe('seed workspace suspension', () => {
  it.effect(
    'does not change state when notice preparation fails and retries once',
    () =>
      Effect.gen(function* () {
        const failing = yield* Ref.make(true)
        const published = yield* Ref.make(0)
        const feed = Layer.mock(NotificationFeed, {
          prepareWorkspaceOwners: () =>
            Effect.gen(function* () {
              if (yield* Ref.get(failing)) {
                return yield* new CapabilityUnavailable({
                  capability: 'notification-feed',
                  reason: 'test_unavailable'
                })
              }
              return {
                writes: [],
                commit: Effect.void,
                publish: Ref.update(published, (count) => count + 1)
              }
            })
        })
        yield* Effect.gen(function* () {
          const suspension = yield* WorkspaceSuspensionService
          const input = {
            workspaceId: 'wrk_live',
            action: 'suspend',
            actor: { userId: 'usr_sysadmin' },
            internalReason: 'Review',
            customerExplanation: 'Contact support.'
          } satisfies Parameters<typeof suspension.transition>[0]
          const failed = yield* suspension.transition(input).pipe(Effect.result)
          expect(failed).toMatchObject({
            _tag: 'Failure',
            failure: { _tag: 'CapabilityUnavailable' }
          })
          expect((yield* suspension.get('wrk_live')).status).toBe('active')
          yield* Ref.set(failing, false)
          yield* suspension.transition(input)
          yield* suspension.transition(input)
          expect(yield* Ref.get(published)).toBe(1)
        }).pipe(Effect.provide(makeLayer(feed)))
      })
  )

  it.effect('refuses direct lifecycle rename and removal while suspended', () =>
    Effect.gen(function* () {
      const suspension = yield* WorkspaceSuspensionService
      yield* suspension.transition({
        workspaceId: 'wrk_live',
        action: 'suspend',
        actor: { userId: 'usr_sysadmin' },
        internalReason: 'Review',
        customerExplanation: 'Contact support.'
      })
      const lifecycle = yield* WorkspaceLifecycle
      expect(
        yield* lifecycle.rename({ name: 'Forbidden rename' }).pipe(Effect.result)
      ).toMatchObject({ _tag: 'Failure', failure: { _tag: 'WorkspaceSuspended' } })
      expect(yield* lifecycle.remove.pipe(Effect.result)).toMatchObject({
        _tag: 'Failure',
        failure: { _tag: 'WorkspaceSuspended' }
      })
    }).pipe(
      Effect.provide(
        SeedWorkspaceLifecycle({ workspace: options.workspace }).pipe(
          Layer.provide(
            SeedBilling().pipe(
              Layer.provide(
                Layer.mergeAll(
                  Layer.mock(BillingAudit, {}),
                  Layer.mock(BillingNotifications, {}),
                  Layer.mock(BillingWebhookPublisher, {})
                )
              )
            )
          ),
          Layer.provide(SeedAssistantDirectory),
          Layer.provideMerge(layer)
        )
      ),
      Effect.provideService(WorkspaceContext, {
        workspace: options.workspace,
        actor: {
          userId: 'usr_owner',
          role: 'owner',
          systemRole: 'user',
          banned: false
        },
        actorType: 'user'
      })
    )
  )

  for (const testCase of workspaceSuspensionContractCases(expect)) {
    it.effect(testCase.name, () => testCase.assert.pipe(Effect.provide(layer)))
  }
})
