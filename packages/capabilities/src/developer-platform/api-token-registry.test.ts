import { expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { SeedLayer } from '../layers.ts'
import { seedApiTokens, seedWorkspaceRecord } from '../seed-fixture.ts'
import { testWorkspaceContext } from '../workspace-context.ts'
import { SeedApiTokenRegistry } from './api-token-registry.seed.ts'
import { ResourceEntitlements } from '@b2b-saas-starter/billing/resource-entitlements'
import {
  ApiTokenRegistry,
  SEED_API_TOKEN,
  SEED_READONLY_API_TOKEN
} from './api-token-registry.ts'
import { apiTokenRegistryContractCases } from './api-token-registry.contract.ts'

for (const contractCase of apiTokenRegistryContractCases(expect)) {
  it.effect(contractCase.name, () =>
    contractCase.assert.pipe(
      Effect.provide(
        Layer.mergeAll(
          SeedLayer,
          testWorkspaceContext({ ...seedWorkspaceRecord, planId: 'team' })
        )
      )
    )
  )
}

it.effect(
  'reordering fixture rows preserves each documented credential and its authority',
  () =>
    Effect.gen(function* () {
      const registry = yield* ApiTokenRegistry
      expect(yield* registry.verifyBearerToken(SEED_API_TOKEN)).toMatchObject({
        id: 'tok_docs',
        scopes: ['read', 'write', 'admin']
      })
      expect(yield* registry.verifyBearerToken(SEED_READONLY_API_TOKEN)).toMatchObject({
        id: 'tok_mcp',
        scopes: ['read']
      })
    }).pipe(
      Effect.provide(
        SeedApiTokenRegistry(seedApiTokens.toReversed()).pipe(Layer.provide(SeedLayer))
      )
    )
)

it.effect('transfers a selected token slot through rotation', () =>
  Effect.gen(function* () {
    const registry = yield* ApiTokenRegistry
    const entitlements = yield* ResourceEntitlements
    yield* entitlements.select({ apiTokenIds: ['tok_docs'], webhookEndpointIds: [] })
    const replacement = yield* registry.replace({
      tokenId: 'tok_docs',
      scopes: ['read'],
      overlapSeconds: 60
    })
    expect(yield* registry.verifyBearerToken(replacement.token)).toMatchObject({
      id: replacement.id
    })
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        SeedLayer,
        testWorkspaceContext({ ...seedWorkspaceRecord, planId: 'team' })
      )
    )
  )
)
