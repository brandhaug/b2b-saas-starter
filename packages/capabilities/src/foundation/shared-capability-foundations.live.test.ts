import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { layerFromD1 } from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  LiveSharedCapabilityFoundations,
  SharedCapabilityFoundations,
  type SharedCommandInput
} from './shared-capability-foundations.ts'

let test: TestD1
const owner = { kind: 'owner', userId: 'usr_owner', merchantId: 'mer_one' } as const
const command: SharedCommandInput = {
  actor: owner,
  merchantId: 'mer_one',
  operation: 'mutation',
  accessState: 'active',
  capability: 'appointment',
  aggregateId: 'apt_one',
  idempotencyKey: 'cmd_one',
  payloadFingerprint: 'sha256:a',
  expectedRevision: 0,
  resultJson: '{"status":"confirmed"}',
  historyKind: 'appointment.confirmed',
  outboxKind: 'appointment-confirmation',
  now: '2026-08-02T12:00:00.000Z'
}
beforeAll(async () => {
  test = await provisionTestD1()
}, 60_000)
afterAll(async () => test.dispose())
const layer = () =>
  LiveSharedCapabilityFoundations.pipe(Layer.provide(layerFromD1(test.d1)))
const execute = (input: SharedCommandInput) =>
  Effect.runPromise(
    Effect.provide(
      Effect.flatMap(SharedCapabilityFoundations, (service) => service.execute(input)),
      layer()
    )
  )
const count = async (table: string) =>
  (await test.d1
    .prepare(`SELECT count(*) count FROM ${table}`)
    .first<{ count: number }>())!.count

describe('Live D1 shared capability foundations', () => {
  it('atomically commits revision, replay, immutable history, minimized audit, and PII-free wake-up', async () => {
    expect(await execute(command)).toMatchObject({ revision: 1, replayed: false })
    expect(await execute(command)).toMatchObject({ revision: 1, replayed: true })
    await expect(
      execute({ ...command, payloadFingerprint: 'sha256:changed' })
    ).rejects.toMatchObject({ reason: 'idempotency_key_reused' })
    expect(await count('capability_history')).toBe(1)
    expect(await count('capability_audit')).toBe(1)
    expect(await count('capability_outbox')).toBe(1)
    const outbox = await test.d1
      .prepare('SELECT * FROM capability_outbox')
      .first<Record<string, unknown>>()
    expect(JSON.stringify(outbox)).not.toMatch(/email|phone|customer/i)
  })
  it('makes competing stale transactions first-commit-wins', async () => {
    const base = { ...command, aggregateId: 'apt_race', idempotencyKey: 'race_a' }
    const settled = await Promise.allSettled([
      execute(base),
      execute({ ...base, idempotencyKey: 'race_b', payloadFingerprint: 'sha256:b' })
    ])
    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(settled.filter((result) => result.status === 'rejected')).toHaveLength(1)
    await expect(
      execute({
        ...command,
        aggregateId: 'apt_never_created',
        idempotencyKey: 'stale_create',
        expectedRevision: 4
      })
    ).rejects.toMatchObject({ reason: 'stale_revision' })
    expect(
      await test.d1
        .prepare(
          "SELECT * FROM capability_aggregate_revisions WHERE aggregate_id = 'apt_never_created'"
        )
        .first()
    ).toBeNull()
  })
  it('denied mutations have zero domain, outbox, financial, and success-audit consequences', async () => {
    const before = await Promise.all(
      [
        'capability_commands',
        'capability_history',
        'capability_audit',
        'capability_outbox'
      ].map(count)
    )
    await expect(
      execute({
        ...command,
        idempotencyKey: 'denied',
        aggregateId: 'apt_denied',
        accessState: 'held'
      })
    ).rejects.toMatchObject({ reason: 'merchant_access_held' })
    const after = await Promise.all(
      [
        'capability_commands',
        'capability_history',
        'capability_audit',
        'capability_outbox'
      ].map(count)
    )
    expect(after).toEqual(before)
  })
  it('stores impersonation provenance without customer data', async () => {
    await execute({
      ...command,
      aggregateId: 'apt_imp',
      idempotencyKey: 'imp',
      actor: {
        kind: 'impersonation',
        operatorId: 'opr_one',
        targetUserId: 'usr_owner',
        merchantId: 'mer_one',
        impersonationId: 'imp_one'
      }
    })
    expect(
      await test.d1
        .prepare(
          "SELECT actor_kind, actor_id, impersonation_id FROM capability_audit WHERE aggregate_id = 'apt_imp'"
        )
        .first()
    ).toEqual({
      actor_kind: 'operator',
      actor_id: 'opr_one',
      impersonation_id: 'imp_one'
    })
  })
  it('redelivers stale claims once and prevents overlapping sweep ownership', async () => {
    await execute({ ...command, aggregateId: 'apt_claim', idempotencyKey: 'claim' })
    const first = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(SharedCapabilityFoundations, (service) =>
          service.claim({
            workerId: 'worker-a',
            now: '2026-08-02T12:01:00.000Z',
            staleBefore: '2026-08-02T11:00:00.000Z',
            limit: 10
          })
        ),
        layer()
      )
    )
    const overlap = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(SharedCapabilityFoundations, (service) =>
          service.claim({
            workerId: 'worker-b',
            now: '2026-08-02T12:01:00.000Z',
            staleBefore: '2026-08-02T11:00:00.000Z',
            limit: 10
          })
        ),
        layer()
      )
    )
    expect(first.some((item) => item.aggregateId === 'apt_claim')).toBe(true)
    expect(overlap.some((item) => item.aggregateId === 'apt_claim')).toBe(false)
    const recovered = await Effect.runPromise(
      Effect.provide(
        Effect.flatMap(SharedCapabilityFoundations, (service) =>
          service.claim({
            workerId: 'worker-b',
            now: '2026-08-02T13:00:00.000Z',
            staleBefore: '2026-08-02T12:30:00.000Z',
            limit: 10
          })
        ),
        layer()
      )
    )
    expect(recovered.some((item) => item.aggregateId === 'apt_claim')).toBe(true)
  })
})
