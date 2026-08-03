import { Effect } from 'effect'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  capabilityOperations,
  renderAuthorizationMatrix,
  SeedSharedCapabilityFoundations,
  SharedCapabilityFoundations,
  type CapabilityAuthorityReference,
  type QueueWakeup,
  type SharedCommandInput
} from './shared-capability-foundations.ts'
import {
  authorizationMatrix,
  merchantCapabilityAuthorizationInventory
} from '../authorization-policy.ts'

const authority = {
  merchantId: 'mer_one',
  actorKind: 'owner',
  actorId: 'usr_owner',
  impersonationId: null,
  accessState: 'active'
} as const
const authorityKey = (reference: CapabilityAuthorityReference) =>
  JSON.stringify([reference])
const ownerAuthorityKey = (sessionId: string) =>
  authorityKey({ kind: 'owner-session', sessionId })
const input: SharedCommandInput = {
  authority: { kind: 'owner-session', sessionId: 'ses_owner' },
  merchantId: 'mer_one',
  operation: 'mutation',
  capability: 'test',
  aggregateId: 'agg_one',
  idempotencyKey: 'one',
  payloadFingerprint: 'sha256:a',
  expectedRevision: 0,
  resultJson: '{"ok":true}',
  historyKind: 'changed',
  outboxKind: 'notify',
  now: '2026-08-03T09:00:00.000Z'
}

describe('shared capability deterministic contract', () => {
  it('resolves authority references and shares replay and changed-payload behavior', async () => {
    const wakeups: QueueWakeup[] = []
    const layer = SeedSharedCapabilityFoundations({
      authorities: new Map([[ownerAuthorityKey('ses_owner'), authority]]),
      publishWakeup: (wakeup) => wakeups.push(wakeup)
    })
    const result = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const service = yield* SharedCapabilityFoundations
          const first = yield* service.execute(input)
          const replay = yield* service.execute({
            ...input,
            now: '2026-08-03T09:05:00.000Z'
          })
          return { first, replay }
        }),
        layer
      )
    )
    expect(result.first).toMatchObject({ revision: 1, replayed: false })
    expect(result.replay).toMatchObject({ revision: 1, replayed: true })
    expect(wakeups).toHaveLength(2)
  })

  it('rejects unknown authority without applying a domain mutation', async () => {
    let domainChanges = 0
    const layer = SeedSharedCapabilityFoundations({
      buildDomainMutation: (command) => ({
        merchantId: command.merchantId,
        mutations: []
      }),
      applyDomainMutation: () => domainChanges++
    })
    await expect(
      Effect.runPromise(
        Effect.provide(
          Effect.flatMap(SharedCapabilityFoundations, (service) =>
            service.execute(input, { kind: 'test', payloadJson: '{}' })
          ),
          layer
        )
      )
    ).rejects.toMatchObject({ reason: 'authority_not_found' })
    expect(domainChanges).toBe(0)
  })

  it('does not claim work before availableAt', async () => {
    const layer = SeedSharedCapabilityFoundations({
      authorities: new Map([[ownerAuthorityKey('ses_owner'), authority]])
    })
    const claimed = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const service = yield* SharedCapabilityFoundations
          yield* service.execute({
            ...input,
            availableAt: '2026-08-03T10:00:00.000Z'
          })
          return yield* service.claim({
            workerId: 'worker',
            now: '2026-08-03T09:30:00.000Z',
            staleBefore: '2026-08-03T08:30:00.000Z',
            limit: 10
          })
        }),
        layer
      )
    )
    expect(claimed).toEqual([])
  })

  it('lets two Merchants independently create the same aggregate id', async () => {
    const wakeups: QueueWakeup[] = []
    const secondAuthority = {
      ...authority,
      merchantId: 'mer_two',
      actorId: 'usr_two'
    }
    const layer = SeedSharedCapabilityFoundations({
      authorities: new Map([
        [ownerAuthorityKey('ses_owner'), authority],
        [ownerAuthorityKey('ses_two'), secondAuthority]
      ]),
      publishWakeup: (wakeup) => wakeups.push(wakeup)
    })
    const results = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const service = yield* SharedCapabilityFoundations
          const first = yield* service.execute(input)
          const second = yield* service.execute({
            ...input,
            authority: { kind: 'owner-session', sessionId: 'ses_two' },
            merchantId: 'mer_two',
            idempotencyKey: 'two'
          })
          return [first, second]
        }),
        layer
      )
    )
    expect(results.map((result) => result.revision)).toEqual([1, 1])
    expect(wakeups).toEqual([
      {
        version: 1,
        kind: 'capability-outbox',
        outboxId: 'cob:["mer_one","test","agg_one",1]'
      },
      {
        version: 1,
        kind: 'capability-outbox',
        outboxId: 'cob:["mer_two","test","agg_one",1]'
      }
    ])
  })

  it('returns the same not-found result for unknown and cross-Merchant aggregates', async () => {
    const secondAuthority = {
      ...authority,
      merchantId: 'mer_two',
      actorId: 'usr_two'
    }
    const layer = SeedSharedCapabilityFoundations({
      authorities: new Map([
        [ownerAuthorityKey('ses_owner'), authority],
        [ownerAuthorityKey('ses_two'), secondAuthority]
      ])
    })
    const run = (command: SharedCommandInput) =>
      Effect.runPromise(
        Effect.provide(
          Effect.flatMap(SharedCapabilityFoundations, (service) =>
            service.execute(command)
          ),
          layer
        )
      )

    await run({ ...input, outboxKind: undefined })
    const [foreign, unknown] = await Promise.allSettled([
      run({
        ...input,
        authority: { kind: 'owner-session', sessionId: 'ses_two' },
        merchantId: 'mer_two',
        idempotencyKey: 'foreign',
        expectedRevision: 1,
        outboxKind: undefined
      }),
      run({
        ...input,
        authority: { kind: 'owner-session', sessionId: 'ses_two' },
        merchantId: 'mer_two',
        aggregateId: 'agg_missing',
        idempotencyKey: 'unknown',
        expectedRevision: 1,
        outboxKind: undefined
      })
    ])
    expect(foreign).toMatchObject({
      status: 'rejected',
      reason: { _tag: 'CapabilityNotFound', resource: 'merchant-resource' }
    })
    expect(unknown).toEqual(foreign)
  })

  it('rejects same-key replay when structural command or domain input changes', async () => {
    const layer = SeedSharedCapabilityFoundations({
      authorities: new Map([[ownerAuthorityKey('ses_owner'), authority]]),
      buildDomainMutation: (command) => ({
        merchantId: command.merchantId,
        mutations: []
      })
    })
    const run = (
      command: SharedCommandInput,
      domainInput: { readonly kind: string; readonly payloadJson: string }
    ) =>
      Effect.runPromise(
        Effect.provide(
          Effect.flatMap(SharedCapabilityFoundations, (service) =>
            service.execute(command, domainInput)
          ),
          layer
        )
      )
    const originalDomainInput = { kind: 'test', payloadJson: '{"value":1}' }

    await run({ ...input, outboxKind: undefined }, originalDomainInput)
    await expect(
      run(
        { ...input, aggregateId: 'agg_changed', outboxKind: undefined },
        originalDomainInput
      )
    ).rejects.toMatchObject({ reason: 'idempotency_key_reused' })
    await expect(
      run(
        { ...input, outboxKind: undefined },
        { kind: 'test', payloadJson: '{"value":2}' }
      )
    ).rejects.toMatchObject({ reason: 'idempotency_key_reused' })
    const update = {
      ...input,
      idempotencyKey: 'update',
      expectedRevision: 1,
      outboxKind: undefined
    }
    await run(update, originalDomainInput)
    await expect(
      run({ ...update, aggregateId: 'agg_update_changed' }, originalDomainInput)
    ).rejects.toMatchObject({ reason: 'idempotency_key_reused' })
  })

  it('creates distinct outbox work for delimiter-colliding identity components', async () => {
    const wakeups: QueueWakeup[] = []
    const layer = SeedSharedCapabilityFoundations({
      authorities: new Map([[ownerAuthorityKey('ses_owner'), authority]]),
      publishWakeup: (wakeup) => wakeups.push(wakeup)
    })
    await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const service = yield* SharedCapabilityFoundations
          yield* service.execute({
            ...input,
            capability: 'appointment',
            aggregateId: 'y_appointment_z',
            idempotencyKey: 'collision-one'
          })
          yield* service.execute({
            ...input,
            capability: 'appointment_y',
            aggregateId: 'appointment_z',
            idempotencyKey: 'collision-two'
          })
        }),
        layer
      )
    )
    expect(wakeups).toEqual([
      {
        version: 1,
        kind: 'capability-outbox',
        outboxId: 'cob:["mer_one","appointment","y_appointment_z",1]'
      },
      {
        version: 1,
        kind: 'capability-outbox',
        outboxId: 'cob:["mer_one","appointment_y","appointment_z",1]'
      }
    ])
  })

  it('keeps delimiter-shaped command and aggregate identities independent', async () => {
    const layer = SeedSharedCapabilityFoundations({
      authorities: new Map([[ownerAuthorityKey('ses_owner'), authority]])
    })
    const results = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const service = yield* SharedCapabilityFoundations
          const first = yield* service.execute({
            ...input,
            capability: 'appointment',
            aggregateId: 'y:appointment:y',
            idempotencyKey: 'y:appointment_y:z',
            outboxKind: undefined
          })
          const second = yield* service.execute({
            ...input,
            capability: 'appointment:y',
            aggregateId: 'appointment:y',
            idempotencyKey: 'appointment_y:z',
            outboxKind: undefined
          })
          return [first, second]
        }),
        layer
      )
    )
    expect(results.map((result) => result.aggregateId)).toEqual([
      'y:appointment:y',
      'appointment:y'
    ])
    expect(results.map((result) => result.revision)).toEqual([1, 1])
  })

  it('keeps delimiter-shaped claimed-work authority references independent', async () => {
    const firstReference = {
      kind: 'claimed-work',
      workerId: 'worker:a',
      outboxId: 'b'
    } as const
    const secondReference = {
      kind: 'claimed-work',
      workerId: 'worker',
      outboxId: 'a:b'
    } as const
    const systemAuthority = {
      ...authority,
      actorKind: 'system' as const
    }
    const layer = SeedSharedCapabilityFoundations({
      authorities: new Map([
        [authorityKey(firstReference), systemAuthority],
        [authorityKey(secondReference), systemAuthority]
      ])
    })
    const results = await Effect.runPromise(
      Effect.provide(
        Effect.gen(function* () {
          const service = yield* SharedCapabilityFoundations
          const first = yield* service.execute({
            ...input,
            authority: firstReference,
            operation: 'queued-action',
            aggregateId: 'claimed_one',
            idempotencyKey: 'claimed_one',
            outboxKind: undefined
          })
          const second = yield* service.execute({
            ...input,
            authority: secondReference,
            operation: 'queued-action',
            aggregateId: 'claimed_two',
            idempotencyKey: 'claimed_two',
            outboxKind: undefined
          })
          return [first, second]
        }),
        layer
      )
    )
    expect(results.map((result) => result.aggregateId)).toEqual([
      'claimed_one',
      'claimed_two'
    ])
  })

  it('renders the checked-in matrix from the executable policy inventory', () => {
    expect(
      Object.fromEntries(
        merchantCapabilityAuthorizationInventory.map((item) => [
          item.capability,
          [...item.operations]
        ])
      )
    ).toEqual({
      'merchant-catalog': ['read', 'mutation', 'search', 'bulk-operation', 'export'],
      scheduling: ['read', 'mutation', 'search', 'bulk-operation'],
      appointment: capabilityOperations,
      'customer-directory': ['read', 'mutation', 'search', 'bulk-operation', 'export'],
      'merchant-subscription': ['read', 'mutation', 'callback', 'queued-action'],
      notifications: [
        'read',
        'mutation',
        'search',
        'bulk-operation',
        'callback',
        'queued-action'
      ],
      'waiting-list': ['read', 'mutation', 'search', 'bulk-operation', 'queued-action'],
      'walk-ins': ['read', 'mutation', 'search', 'bulk-operation'],
      'reporting-export': ['read', 'search', 'export', 'queued-action'],
      'privacy-request': ['read', 'mutation', 'search', 'export', 'queued-action'],
      'developer-platform': ['read', 'mutation', 'search', 'callback', 'queued-action'],
      pricing: ['read', 'mutation'],
      payments: ['read', 'mutation', 'callback'],
      'gift-cards': ['read', 'mutation'],
      'customer-identity': ['read', 'mutation', 'search'],
      'customer-engagement': ['read', 'mutation', 'search'],
      'scheduled-work': ['read', 'mutation', 'search', 'queued-action'],
      operations: ['read', 'mutation', 'search', 'bulk-operation']
    })
    const keys = authorizationMatrix.map((row) => `${row.capability}:${row.operation}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(
      authorizationMatrix.find((row) => row.operation === 'callback')
    ).toMatchObject({
      owner: false,
      authority: 'callback-correlation'
    })
    expect(
      authorizationMatrix.find((row) => row.operation === 'queued-action')
    ).toMatchObject({ owner: false, authority: 'claimed-work' })
    expect(renderAuthorizationMatrix(authorizationMatrix)).toBe(
      readFileSync(
        new URL(
          '../../../../docs/generated/authorization-merchant-isolation-matrix.md',
          import.meta.url
        ),
        'utf8'
      )
    )
  })
})
