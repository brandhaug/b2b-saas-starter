import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { layerFromD1 } from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  makeLiveSharedCapabilityFoundations,
  SharedCapabilityFoundations,
  type QueueWakeup,
  type SharedCommandInput
} from './shared-capability-foundations.ts'
import { classifyRestrictedMutation } from '../authorization-policy.ts'
import { resolveMerchantSubscriptionAccessState } from '../subscriptions/subscription-access.ts'

let test: TestD1
const now = '2026-08-03T09:00:00.000Z'
const command: SharedCommandInput = {
  authority: { kind: 'owner-session', sessionId: 'ses_owner_one' },
  merchantId: 'mer_one',
  operation: 'mutation',
  capability: 'appointment',
  aggregateId: 'apt_one',
  idempotencyKey: 'cmd_one',
  payloadFingerprint: 'sha256:a',
  expectedRevision: 0,
  resultJson: '{"status":"confirmed"}',
  historyKind: 'appointment.confirmed',
  outboxKind: 'appointment-confirmation',
  now
}
type TestMutation = {
  readonly operation: 'insert'
  readonly table: string
  readonly id: string
  readonly values: Readonly<Record<string, string | number | boolean | null>>
}
const committedMutation: readonly TestMutation[] = [
  {
    operation: 'insert',
    table: 'foundation_domain_probe',
    id: 'probe_one',
    values: { notification_count: 1, financial_minor: 5000 }
  }
]

beforeAll(async () => {
  test = await provisionTestD1()
  const epoch = 4_102_444_800
  await test.d1.batch([
    test.d1.prepare(
      "INSERT INTO user (id,email,name,emailVerified,identityClass,banned,createdAt,updatedAt) VALUES ('usr_one','one@example.test','One',1,'merchant_member',0,1,1)"
    ),
    test.d1.prepare(
      "INSERT INTO user (id,email,name,emailVerified,identityClass,banned,createdAt,updatedAt) VALUES ('usr_two','two@example.test','Two',1,'merchant_member',0,1,1)"
    ),
    test.d1.prepare(
      "INSERT INTO user (id,email,name,emailVerified,identityClass,banned,createdAt,updatedAt) VALUES ('usr_three','three@example.test','Three',1,'merchant_member',0,1,1)"
    ),
    test.d1.prepare(
      "INSERT INTO user (id,email,name,emailVerified,identityClass,banned,createdAt,updatedAt) VALUES ('usr_four','four@example.test','Four',1,'merchant_member',0,1,1)"
    ),
    test.d1.prepare(
      `INSERT INTO session (id,expiresAt,token,createdAt,updatedAt,userId) VALUES ('ses_owner_one',${epoch},'tok_one',1,1,'usr_one')`
    ),
    test.d1.prepare(
      `INSERT INTO session (id,expiresAt,token,createdAt,updatedAt,userId) VALUES ('ses_owner_two',${epoch},'tok_two',1,1,'usr_two')`
    ),
    test.d1.prepare(
      `INSERT INTO session (id,expiresAt,token,createdAt,updatedAt,userId) VALUES ('ses_owner_three',${epoch},'tok_three',1,1,'usr_three')`
    ),
    test.d1.prepare(
      `INSERT INTO session (id,expiresAt,token,createdAt,updatedAt,userId) VALUES ('ses_owner_four',${epoch},'tok_four',1,1,'usr_four')`
    ),
    test.d1
      .prepare(
        "INSERT INTO merchants (id,public_name,slug,status,timezone,currency,plan,created_at,updated_at) VALUES ('mer_one','One','one','enabled','UTC','RON','solo',?,?)"
      )
      .bind(now, now),
    test.d1
      .prepare(
        "INSERT INTO merchants (id,public_name,slug,status,timezone,currency,plan,created_at,updated_at) VALUES ('mer_two','Two','two','enabled','UTC','RON','solo',?,?)"
      )
      .bind(now, now),
    test.d1
      .prepare(
        "INSERT INTO merchants (id,public_name,slug,status,timezone,currency,plan,created_at,updated_at) VALUES ('mer_three','Three','three','enabled','UTC','RON','solo',?,?)"
      )
      .bind(now, now),
    test.d1
      .prepare(
        "INSERT INTO merchants (id,public_name,slug,status,timezone,currency,plan,created_at,updated_at) VALUES ('mer_four','Four','four','enabled','UTC','RON','solo',?,?)"
      )
      .bind(now, now),
    test.d1
      .prepare(
        "INSERT INTO merchant_memberships (merchant_id,user_id,role,created_at) VALUES ('mer_one','usr_one','owner',?)"
      )
      .bind(now),
    test.d1
      .prepare(
        "INSERT INTO merchant_memberships (merchant_id,user_id,role,created_at) VALUES ('mer_two','usr_two','owner',?)"
      )
      .bind(now),
    test.d1
      .prepare(
        "INSERT INTO merchant_memberships (merchant_id,user_id,role,created_at) VALUES ('mer_three','usr_three','owner',?)"
      )
      .bind(now),
    test.d1
      .prepare(
        "INSERT INTO merchant_memberships (merchant_id,user_id,role,created_at) VALUES ('mer_four','usr_four','owner',?)"
      )
      .bind(now),
    test.d1
      .prepare(
        "INSERT INTO merchant_subscriptions (id,merchant_id,plan,status,revision,created_at,updated_at) VALUES ('sub_one','mer_one','solo','active',1,?,?)"
      )
      .bind(now, now),
    test.d1
      .prepare(
        "INSERT INTO merchant_subscriptions (id,merchant_id,plan,status,revision,created_at,updated_at) VALUES ('sub_two','mer_two','solo','active',1,?,?)"
      )
      .bind(now, now),
    test.d1
      .prepare(
        "INSERT INTO merchant_subscriptions (id,merchant_id,plan,status,revision,created_at,updated_at) VALUES ('sub_three','mer_three','solo','restricted',1,?,?)"
      )
      .bind(now, now),
    test.d1
      .prepare(
        "INSERT INTO merchant_subscriptions (id,merchant_id,plan,status,revision,created_at,updated_at) VALUES ('sub_four','mer_four','solo','active',1,?,?)"
      )
      .bind(now, now),
    test.d1
      .prepare(
        "INSERT INTO merchant_access_holds (id,merchant_id,user_id,reason,placed_at) VALUES ('hold_two','mer_two','usr_two','security-review',?)"
      )
      .bind(now),
    test.d1
      .prepare(
        "INSERT INTO capability_aggregate_revisions (merchant_id,capability,aggregate_id,revision,updated_at) VALUES ('mer_three','appointment','apt_restricted',1,?)"
      )
      .bind(now),
    test.d1
      .prepare(
        "INSERT INTO capability_aggregate_revisions (merchant_id,capability,aggregate_id,revision,updated_at) VALUES ('mer_one','appointment','apt_shared',1,?), ('mer_four','appointment','apt_shared',1,?)"
      )
      .bind(now, now),
    test.d1
      .prepare(
        "INSERT INTO capability_aggregate_revisions (merchant_id,capability,aggregate_id,revision,updated_at) VALUES ('mer_one','appointment','apt_shared_create',1,?), ('mer_one','appointment','apt_foreign_only',1,?)"
      )
      .bind(now, now)
  ])
  await test.d1
    .prepare(
      'CREATE TABLE foundation_domain_probe (id text PRIMARY KEY, merchant_id text NOT NULL, notification_count integer NOT NULL, financial_minor integer NOT NULL)'
    )
    .run()
}, 60_000)
afterAll(async () => test.dispose())

const layer = (
  publishWakeup?: (wakeup: QueueWakeup) => Promise<void>,
  handleOutbox?: (claim: {
    readonly id: string
    readonly kind: string
    readonly aggregateId: string
    readonly revision: number
  }) => Promise<void>
) =>
  makeLiveSharedCapabilityFoundations({
    ...(publishWakeup ? { publishWakeup } : {}),
    ...(handleOutbox ? { handleOutbox } : {}),
    buildDomainMutation: (input, request) =>
      request?.kind === 'cross-merchant-plan'
        ? { merchantId: 'mer_two', mutations: [] }
        : {
            merchantId: input.merchantId,
            mutations:
              request?.kind === 'test-mutations'
                ? (JSON.parse(request.payloadJson) as readonly TestMutation[])
                : []
          },
    classifyRestrictedMutation,
    resolveMerchantAccess: resolveMerchantSubscriptionAccessState
  }).pipe(Layer.provide(layerFromD1(test.d1)))
const execute = (
  input: SharedCommandInput,
  publishWakeup: (wakeup: QueueWakeup) => Promise<void> = async () => {},
  mutations: readonly TestMutation[] = [],
  mutationRequest?: { readonly kind: string; readonly payloadJson: string }
) =>
  Effect.runPromise(
    Effect.provide(
      Effect.flatMap(SharedCapabilityFoundations, (service) =>
        service.execute(
          input,
          mutationRequest ??
            (mutations.length > 0
              ? { kind: 'test-mutations', payloadJson: JSON.stringify(mutations) }
              : undefined)
        )
      ),
      layer(publishWakeup)
    )
  )
const count = async (table: string) =>
  (await test.d1
    .prepare(`SELECT count(*) count FROM ${table}`)
    .first<{ count: number }>())!.count
const consequenceCounts = () =>
  Promise.all([
    count('foundation_domain_probe'),
    count('capability_commands'),
    count('capability_history'),
    count('capability_audit'),
    count('capability_outbox'),
    count('notification_intents'),
    count('external_collections')
  ])

describe('Live D1 shared capability foundations', () => {
  it('evaluates authority expiry against the deterministic command clock', async () => {
    await expect(
      execute({
        ...command,
        aggregateId: 'apt_expired_clock',
        idempotencyKey: 'expired_clock',
        outboxKind: undefined,
        now: '2101-01-01T00:00:00.000Z'
      })
    ).rejects.toMatchObject({ reason: 'authority_not_found' })
  })

  it('allows the rightful Merchant when another Merchant uses the same aggregate id', async () => {
    await expect(
      execute({
        ...command,
        authority: { kind: 'owner-session', sessionId: 'ses_owner_one' },
        merchantId: 'mer_one',
        aggregateId: 'apt_shared',
        idempotencyKey: 'shared_one',
        expectedRevision: 1,
        outboxKind: undefined
      })
    ).resolves.toMatchObject({ revision: 2 })

    await expect(
      execute({
        ...command,
        authority: { kind: 'owner-session', sessionId: 'ses_owner_four' },
        merchantId: 'mer_four',
        aggregateId: 'apt_shared_create',
        idempotencyKey: 'shared_create_four',
        expectedRevision: 0,
        outboxKind: undefined
      })
    ).resolves.toMatchObject({ revision: 1 })
  })

  it('isolates outbox work when two Merchants create the same aggregate id', async () => {
    const wakeups: QueueWakeup[] = []
    const publish = async (wakeup: QueueWakeup) => {
      wakeups.push(wakeup)
    }
    const shared = {
      ...command,
      aggregateId: 'apt_shared_outbox',
      outboxKind: 'appointment-confirmation'
    }

    await expect(
      execute({ ...shared, idempotencyKey: 'shared_outbox_one' }, publish)
    ).resolves.toMatchObject({ revision: 1 })
    await expect(
      execute(
        {
          ...shared,
          authority: { kind: 'owner-session', sessionId: 'ses_owner_four' },
          merchantId: 'mer_four',
          idempotencyKey: 'shared_outbox_four'
        },
        publish
      )
    ).resolves.toMatchObject({ revision: 1 })
    expect(wakeups).toEqual([
      {
        version: 1,
        kind: 'capability-outbox',
        outboxId: 'cob:["mer_one","appointment","apt_shared_outbox",1]'
      },
      {
        version: 1,
        kind: 'capability-outbox',
        outboxId: 'cob:["mer_four","appointment","apt_shared_outbox",1]'
      }
    ])
  })

  it('returns the same not-found result for unknown and cross-Merchant aggregates', async () => {
    const candidate = {
      ...command,
      authority: { kind: 'owner-session', sessionId: 'ses_owner_four' } as const,
      merchantId: 'mer_four',
      expectedRevision: 1,
      outboxKind: undefined
    }
    const [foreign, unknown] = await Promise.allSettled([
      execute({
        ...candidate,
        aggregateId: 'apt_foreign_only',
        idempotencyKey: 'foreign_not_found'
      }),
      execute({
        ...candidate,
        aggregateId: 'apt_missing',
        idempotencyKey: 'unknown_not_found'
      })
    ])
    expect(foreign).toMatchObject({
      status: 'rejected',
      reason: { _tag: 'CapabilityNotFound', resource: 'merchant-resource' }
    })
    expect(unknown).toEqual(foreign)
  })

  it('creates distinct outbox work for delimiter-colliding identity components', async () => {
    const wakeups: QueueWakeup[] = []
    const publish = async (wakeup: QueueWakeup) => {
      wakeups.push(wakeup)
    }
    await expect(
      execute(
        {
          ...command,
          capability: 'appointment',
          aggregateId: 'y_appointment_z',
          idempotencyKey: 'delimiter_collision_one'
        },
        publish
      )
    ).resolves.toMatchObject({ revision: 1 })
    await expect(
      execute(
        {
          ...command,
          capability: 'appointment_y',
          aggregateId: 'appointment_z',
          idempotencyKey: 'delimiter_collision_two'
        },
        publish
      )
    ).resolves.toMatchObject({ revision: 1 })
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

  it('keeps delimiter-shaped command identities independent', async () => {
    await expect(
      execute({
        ...command,
        capability: 'appointment',
        aggregateId: 'apt_key_one',
        idempotencyKey: 'y:appointment_y:z',
        outboxKind: undefined
      })
    ).resolves.toMatchObject({ aggregateId: 'apt_key_one', revision: 1 })
    await expect(
      execute({
        ...command,
        capability: 'appointment:y',
        aggregateId: 'apt_key_two',
        idempotencyKey: 'appointment_y:z',
        outboxKind: undefined
      })
    ).resolves.toMatchObject({ aggregateId: 'apt_key_two', revision: 1 })
  })

  it('stores only a digest of canonical replay material', async () => {
    await execute(
      {
        ...command,
        aggregateId: 'apt_fingerprint_digest',
        idempotencyKey: 'fingerprint_digest',
        outboxKind: undefined
      },
      async () => {},
      [],
      { kind: 'pii-probe', payloadJson: '{"email":"customer@example.test"}' }
    )
    const stored = await test.d1
      .prepare(
        "SELECT payload_fingerprint fingerprint FROM capability_commands WHERE aggregate_id = 'apt_fingerprint_digest'"
      )
      .first<{ fingerprint: string }>()
    expect(stored?.fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(stored?.fingerprint).not.toContain('customer@example.test')
  })

  it('resolves a persisted Owner session and commits the domain mutation with consequences', async () => {
    const wakeups: QueueWakeup[] = []
    const before = {
      domain: await count('foundation_domain_probe'),
      history: await count('capability_history'),
      audit: await count('capability_audit'),
      outbox: await count('capability_outbox')
    }
    const result = await execute(
      command,
      async (wakeup) => {
        wakeups.push(wakeup)
      },
      committedMutation
    )
    expect(result).toMatchObject({ revision: 1, replayed: false })
    expect(await count('foundation_domain_probe')).toBe(before.domain + 1)
    expect(await count('capability_history')).toBe(before.history + 1)
    expect(await count('capability_audit')).toBe(before.audit + 1)
    expect(await count('capability_outbox')).toBe(before.outbox + 1)
    expect(wakeups).toEqual([
      {
        version: 1,
        kind: 'capability-outbox',
        outboxId: 'cob:["mer_one","appointment","apt_one",1]'
      }
    ])
  })

  it('keeps the commit durable when enqueue fails and republishes on replay', async () => {
    const replayed: QueueWakeup[] = []
    const input = { ...command, aggregateId: 'apt_enqueue', idempotencyKey: 'enqueue' }
    const mutations: readonly TestMutation[] = [
      {
        operation: 'insert',
        table: 'foundation_domain_probe',
        id: 'probe_enqueue',
        values: { notification_count: 1, financial_minor: 0 }
      }
    ]
    await expect(
      execute(
        input,
        async () => {
          throw new Error('queue unavailable')
        },
        mutations
      )
    ).rejects.toMatchObject({ _tag: 'CapabilityUnavailable' })
    expect(
      await test.d1
        .prepare("SELECT id FROM foundation_domain_probe WHERE id = 'probe_enqueue'")
        .first()
    ).not.toBeNull()
    expect(
      await execute(
        { ...input, now: '2026-08-03T09:05:00.000Z' },
        async (wakeup) => {
          replayed.push(wakeup)
        },
        mutations
      )
    ).toMatchObject({ replayed: true })
    expect(replayed).toHaveLength(1)
  })

  it('rejects missing and cross-Merchant authority before every consequence', async () => {
    const before = await consequenceCounts()
    await expect(
      execute(
        {
          ...command,
          authority: { kind: 'owner-session', sessionId: 'missing' },
          aggregateId: 'apt_denied',
          idempotencyKey: 'denied'
        },
        async () => {},
        [
          {
            operation: 'insert',
            table: 'foundation_domain_probe',
            id: 'denied',
            values: { notification_count: 1, financial_minor: 999 }
          },
          {
            operation: 'insert',
            table: 'notification_intents',
            id: 'denied_notification',
            values: {}
          },
          {
            operation: 'insert',
            table: 'external_collections',
            id: 'denied_financial',
            values: {}
          }
        ]
      )
    ).rejects.toMatchObject({ reason: 'authority_not_found' })
    await expect(
      execute({
        ...command,
        authority: { kind: 'owner-session', sessionId: 'ses_owner_two' },
        aggregateId: 'apt_one',
        idempotencyKey: 'cross',
        expectedRevision: 1
      })
    ).rejects.toMatchObject({ _tag: 'CapabilityNotFound' })
    const crossMerchantReplay = {
      ...command,
      authority: { kind: 'owner-session', sessionId: 'ses_owner_two' } as const
    }
    const [exactReplay, changedReplay] = await Promise.allSettled([
      execute(crossMerchantReplay),
      execute({ ...crossMerchantReplay, payloadFingerprint: 'sha256:changed' })
    ])
    expect(exactReplay).toMatchObject({
      status: 'rejected',
      reason: { _tag: 'CapabilityNotFound', resource: 'merchant-resource' }
    })
    expect(changedReplay).toEqual(exactReplay)
    const after = await consequenceCounts()
    expect(after).toEqual(before)
  })

  it('derives Access Hold from persisted Merchant state', async () => {
    const before = await consequenceCounts()
    await expect(
      execute(
        {
          ...command,
          authority: { kind: 'owner-session', sessionId: 'ses_owner_two' },
          merchantId: 'mer_two',
          aggregateId: 'apt_held',
          idempotencyKey: 'held'
        },
        async () => {},
        [
          {
            operation: 'insert',
            table: 'foundation_domain_probe',
            id: 'held',
            values: { notification_count: 1, financial_minor: 999 }
          }
        ]
      )
    ).rejects.toMatchObject({ reason: 'merchant_access_held' })
    expect(
      await test.d1
        .prepare("SELECT id FROM foundation_domain_probe WHERE id = 'held'")
        .first()
    ).toBeNull()
    expect(await consequenceCounts()).toEqual(before)
  })

  it('derives Restricted Access and permits only declared safe exceptions', async () => {
    const restricted = {
      ...command,
      authority: { kind: 'owner-session', sessionId: 'ses_owner_three' } as const,
      merchantId: 'mer_three',
      aggregateId: 'apt_restricted',
      idempotencyKey: 'restricted',
      expectedRevision: 1,
      outboxKind: undefined
    }
    const before = await consequenceCounts()
    await expect(execute(restricted)).rejects.toMatchObject({
      reason: 'restricted_access'
    })
    await expect(
      execute(restricted, async () => {}, [], {
        kind: 'merchant-subscription-billing-recovery',
        payloadJson: '[]'
      })
    ).rejects.toMatchObject({ reason: 'restricted_access' })
    expect(await consequenceCounts()).toEqual(before)
    await expect(
      execute(restricted, async () => {}, [], {
        kind: 'appointment-existing-commitment',
        payloadJson: JSON.stringify({
          appointmentId: 'apt_restricted',
          action: 'reschedule'
        })
      })
    ).resolves.toMatchObject({ revision: 2 })
  })

  it('rejects a malformed cross-Merchant adapter plan before consequences', async () => {
    const before = await consequenceCounts()
    await expect(
      execute(
        {
          ...command,
          aggregateId: 'apt_bad_adapter',
          idempotencyKey: 'bad_adapter',
          outboxKind: undefined
        },
        async () => {},
        [],
        { kind: 'cross-merchant-plan', payloadJson: '[]' }
      )
    ).rejects.toMatchObject({ _tag: 'CapabilityNotFound' })
    expect(await consequenceCounts()).toEqual(before)
  })

  it('enforces idempotency, stale revisions, and first-commit-wins', async () => {
    expect(await execute(command, async () => {}, committedMutation)).toMatchObject({
      replayed: true
    })
    await expect(
      execute({ ...command, payloadFingerprint: 'sha256:changed' })
    ).rejects.toMatchObject({ reason: 'idempotency_key_reused' })
    const structural = {
      ...command,
      aggregateId: 'apt_structural_replay',
      idempotencyKey: 'structural_replay',
      outboxKind: undefined
    }
    const structuralDomainInput = { kind: 'test-mutations', payloadJson: '[]' }
    await expect(
      execute(structural, async () => {}, [], structuralDomainInput)
    ).resolves.toMatchObject({ revision: 1 })
    await expect(
      execute(
        { ...structural, aggregateId: 'apt_structural_changed' },
        async () => {},
        [],
        structuralDomainInput
      )
    ).rejects.toMatchObject({ reason: 'idempotency_key_reused' })
    await expect(
      execute(structural, async () => {}, [], {
        kind: 'test-mutations',
        payloadJson:
          '[{"operation":"delete","table":"foundation_domain_probe","id":"missing"}]'
      })
    ).rejects.toMatchObject({ reason: 'idempotency_key_reused' })
    const structuralUpdate = {
      ...structural,
      idempotencyKey: 'structural_update_replay',
      expectedRevision: 1
    }
    await expect(
      execute(structuralUpdate, async () => {}, [], structuralDomainInput)
    ).resolves.toMatchObject({ revision: 2 })
    await expect(
      execute(
        { ...structuralUpdate, aggregateId: 'apt_structural_update_changed' },
        async () => {},
        [],
        structuralDomainInput
      )
    ).rejects.toMatchObject({ reason: 'idempotency_key_reused' })
    const base = {
      ...command,
      aggregateId: 'apt_race',
      idempotencyKey: 'race_a',
      outboxKind: undefined
    }
    const settled = await Promise.allSettled([
      execute(base),
      execute({ ...base, idempotencyKey: 'race_b', payloadFingerprint: 'sha256:b' })
    ])
    expect(settled.filter((item) => item.status === 'fulfilled')).toHaveLength(1)
    expect(settled.filter((item) => item.status === 'rejected')).toHaveLength(1)
    const sameKey = {
      ...command,
      aggregateId: 'apt_same_key',
      idempotencyKey: 'same_key',
      outboxKind: undefined
    }
    const sameKeyResults = await Promise.all([execute(sameKey), execute(sameKey)])
    expect(sameKeyResults.filter((item) => item.replayed)).toHaveLength(1)
  })

  it('does not claim future work and recovers stale claims without overlap', async () => {
    await execute({
      ...command,
      aggregateId: 'apt_future',
      idempotencyKey: 'future',
      availableAt: '2026-08-03T11:00:00.000Z'
    })
    const runClaim = (workerId: string, claimNow: string, staleBefore: string) =>
      Effect.runPromise(
        Effect.provide(
          Effect.flatMap(SharedCapabilityFoundations, (service) =>
            service.claim({ workerId, now: claimNow, staleBefore, limit: 20 })
          ),
          layer(async () => {})
        )
      )
    const early = await runClaim(
      'worker-a',
      '2026-08-03T10:00:00.000Z',
      '2026-08-03T08:00:00.000Z'
    )
    expect(early.some((item) => item.aggregateId === 'apt_future')).toBe(false)
    const first = await runClaim(
      'worker-a',
      '2026-08-03T11:01:00.000Z',
      '2026-08-03T08:00:00.000Z'
    )
    const overlap = await runClaim(
      'worker-b',
      '2026-08-03T11:01:00.000Z',
      '2026-08-03T10:00:00.000Z'
    )
    expect(first.some((item) => item.aggregateId === 'apt_future')).toBe(true)
    expect(overlap.some((item) => item.aggregateId === 'apt_future')).toBe(false)
    const recovered = await runClaim(
      'worker-b',
      '2026-08-03T12:00:00.000Z',
      '2026-08-03T11:30:00.000Z'
    )
    expect(recovered.some((item) => item.aggregateId === 'apt_future')).toBe(true)
  })

  it('claims, dispatches, completes, and safely redelivers one Queue wake-up', async () => {
    const input = {
      ...command,
      aggregateId: 'apt_process',
      idempotencyKey: 'process'
    }
    await execute(input)
    const handled: string[] = []
    const processLayer = layer(
      async () => {},
      async (claim) => {
        handled.push(claim.id)
      }
    )
    const process = () =>
      Effect.runPromise(
        Effect.provide(
          Effect.flatMap(SharedCapabilityFoundations, (service) =>
            service.process({
              outboxId: 'cob:["mer_one","appointment","apt_process",1]',
              workerId: 'worker-process',
              now: '2026-08-03T09:01:00.000Z',
              staleBefore: '2026-08-03T08:56:00.000Z'
            })
          ),
          processLayer
        )
      )
    await process()
    await process()
    expect(handled).toEqual(['cob:["mer_one","appointment","apt_process",1]'])
    expect(
      await test.d1
        .prepare(
          `SELECT status FROM capability_outbox WHERE id = 'cob:["mer_one","appointment","apt_process",1]'`
        )
        .first<{ status: string }>()
    ).toEqual({ status: 'processed' })
  })
})
