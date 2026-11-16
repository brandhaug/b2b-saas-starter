import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit, Layer, Schema } from 'effect'
import { SeedLayer } from '../layers.ts'
import { SeedWebhookEndpoints } from './webhook-endpoints.seed.ts'
import { adminDeliveryFixtures } from './webhook-endpoints.admin.contract.ts'
import {
  deliveryViewEndpoints,
  deliveryViewFilterContract,
  deliveryViewWorkspaces
} from './webhook-delivery-view.contract.ts'
import { DeliveryView } from './webhook-delivery-view.ts'

const decodeView = Schema.decodeUnknownExit(DeliveryView)

describe('Seed delivery view filters', () => {
  it.effect('interprets filters with the shared table-filter semantics', () =>
    deliveryViewFilterContract(expect).pipe(
      Effect.provide(
        SeedWebhookEndpoints(
          deliveryViewEndpoints,
          adminDeliveryFixtures,
          deliveryViewWorkspaces
        ).pipe(Layer.provideMerge(SeedLayer))
      )
    )
  )
})

describe('delivery view input', () => {
  // How it could fail: the schema accepts any operator on any field, so a
  // crafted URL reaches the interpreters with `contains` on a number or
  // ordering on a select, which the admin table never offers.
  it('offers each field only the operators of its kind', () => {
    for (const filter of [
      { field: 'attempts', operator: 'contains', value: '1' },
      { field: 'status', operator: 'contains', value: 'dead' },
      { field: 'status', operator: 'before', value: 'dead' },
      { field: 'lastAttemptAt', operator: 'notContains', value: '2026' },
      { field: 'endpointUrl', operator: 'gt', value: 'a' }
    ]) {
      expect(
        Exit.isFailure(decodeView({ match: 'all', filters: [filter], sorts: [] }))
      ).toBe(true)
    }
    for (const filter of [
      { field: 'attempts', operator: 'gt', value: '1' },
      { field: 'status', operator: 'is', value: 'dead_lettered' },
      { field: 'endpointUrl', operator: 'contains', value: 'example' },
      {
        field: 'lastAttemptAt',
        operator: 'is',
        value: '2026-09-01T00:00:00.000Z',
        endValue: '2026-09-01T23:59:59.999Z'
      }
    ]) {
      expect(
        Exit.isSuccess(decodeView({ match: 'all', filters: [filter], sorts: [] }))
      ).toBe(true)
    }
  })
})
