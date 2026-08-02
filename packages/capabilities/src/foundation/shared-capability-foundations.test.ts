import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { CapabilityDenied, CapabilityNotFound } from '../errors.ts'
import {
  accessAllows,
  authorizationMatrix,
  authorizeCapability,
  SeedSharedCapabilityFoundations,
  SharedCapabilityFoundations,
  type SharedCommandInput
} from './shared-capability-foundations.ts'

const owner = { kind: 'owner', userId: 'usr_owner', merchantId: 'mer_one' } as const
const input: SharedCommandInput = {
  actor: owner,
  merchantId: 'mer_one',
  operation: 'mutation',
  accessState: 'active',
  capability: 'test',
  aggregateId: 'agg_one',
  idempotencyKey: 'one',
  payloadFingerprint: 'sha256:a',
  expectedRevision: 0,
  resultJson: '{"ok":true}',
  historyKind: 'changed',
  outboxKind: 'notify',
  now: '2026-08-02T12:00:00.000Z'
}
const run = <A>(effect: Effect.Effect<A, unknown, SharedCapabilityFoundations>) =>
  Effect.runPromise(Effect.provide(effect, SeedSharedCapabilityFoundations()))

describe('shared capability policy', () => {
  it('uses non-disclosing not-found for cross-Merchant access', () => {
    expect(
      authorizeCapability({ ...input, resourceMerchantId: 'mer_two' })
    ).toBeInstanceOf(CapabilityNotFound)
    expect(authorizeCapability({ ...input, actor: null })).toBeInstanceOf(
      CapabilityDenied
    )
  })
  it('generates coverage for every ingress operation and restriction state', () => {
    expect(authorizationMatrix.map((row) => row.operation)).toEqual([
      'read',
      'mutation',
      'search',
      'bulk-operation',
      'export',
      'callback',
      'queued-action'
    ])
    expect(accessAllows('restricted', { ...input, operation: 'read' })).toBe(true)
    expect(accessAllows('restricted', input)).toBe(false)
    expect(
      accessAllows('restricted', {
        ...input,
        restrictedException: 'existing-commitment'
      })
    ).toBe(true)
    expect(accessAllows('held', { ...input, operation: 'read' })).toBe(false)
  })
  it('shares replay, changed-payload, revision, and attributed actor contracts', async () => {
    const [first, replay] = await run(
      Effect.gen(function* () {
        const service = yield* SharedCapabilityFoundations
        return [yield* service.execute(input), yield* service.execute(input)] as const
      })
    )
    expect(first.revision).toBe(1)
    expect(replay.replayed).toBe(true)
    await expect(
      run(
        Effect.gen(function* () {
          const service = yield* SharedCapabilityFoundations
          yield* service.execute(input)
          return yield* service.execute({ ...input, payloadFingerprint: 'sha256:b' })
        })
      )
    ).rejects.toMatchObject({ reason: 'idempotency_key_reused' })
  })
})
