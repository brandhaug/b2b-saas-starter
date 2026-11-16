import { WebhookDeliveryId, WebhookEndpointId } from '@b2b-saas-starter/db/ids'
import { Effect } from 'effect'
import { type ContractExpect } from '../governance/contract-expect.ts'
import { walkKeysetPages } from '../internal/keyset-cursor.ts'
import { WebhookEndpoints } from './webhook-endpoints.ts'
import {
  deliveryViewLimits,
  type DeliveryView,
  type DeliveryViewFilter
} from './webhook-delivery-view.ts'

/** The endpoints `adminDeliveryFixtures` deliver to, seeded by both passes. */
export const deliveryViewEndpoints = [
  {
    id: WebhookEndpointId.make('wh_admin_a'),
    workspaceId: 'wrk_live',
    url: 'https://example.com/a',
    enabled: true,
    events: ['demo.event']
  },
  {
    id: WebhookEndpointId.make('wh_admin_b'),
    workspaceId: 'wrk_other',
    url: 'https://example.com/b',
    enabled: true,
    events: ['demo.event']
  }
]

/** The Seed workspace records; the Live harness already holds both. */
export const deliveryViewWorkspaces = [
  { id: 'wrk_live', slug: 'live-lab', name: 'Live Lab', planId: 'team' },
  { id: 'wrk_other', slug: 'other-lab', name: 'Other Lab', planId: 'team' }
]

/**
 * Delivery-view filters, run against both adapters over
 * `adminDeliveryFixtures` (whose terminal rows are the global list). The
 * cases pin the table-filter semantics (`internal/table-filter.ts`) on a
 * numeric field, a nullable timestamp and joined text, and the largest view
 * the schema admits, which must stay inside D1's bound-parameter limit.
 */
export function deliveryViewFilterContract(expect: ContractExpect) {
  return Effect.gen(function* () {
    const webhooks = yield* WebhookEndpoints
    function ids(filter: DeliveryViewFilter) {
      return webhooks
        .listGlobalDeliveries({ view: { match: 'all', filters: [filter], sorts: [] } })
        .pipe(Effect.map((page) => page.items.map((row) => row.id)))
    }
    const every = [
      WebhookDeliveryId.make('whd_admin_z'),
      WebhookDeliveryId.make('whd_admin_y'),
      WebhookDeliveryId.make('whd_admin_null_z'),
      WebhookDeliveryId.make('whd_admin_null_a')
    ]
    // Presence ignores the value, even one that is not a number.
    expect(
      yield* ids({ field: 'attempts', operator: 'isNotEmpty', value: 'many' })
    ).toEqual(every)
    expect(
      yield* ids({ field: 'attempts', operator: 'isEmpty', value: 'many' })
    ).toEqual([])
    // A comparison against a non-numeric value matches no row, negation included.
    for (const operator of ['is', 'isNot', 'gt', 'lt'] as const) {
      expect(yield* ids({ field: 'attempts', operator, value: 'many' })).toEqual([])
    }
    expect(yield* ids({ field: 'attempts', operator: 'isNot', value: '1' })).toEqual([
      WebhookDeliveryId.make('whd_admin_z')
    ])
    // Text equality and containment fold ASCII case; negation is the complement.
    expect(
      yield* ids({ field: 'endpointUrl', operator: 'contains', value: 'EXAMPLE.COM/A' })
    ).toEqual([
      WebhookDeliveryId.make('whd_admin_z'),
      WebhookDeliveryId.make('whd_admin_null_a')
    ])
    expect(
      yield* ids({
        field: 'endpointUrl',
        operator: 'notContains',
        value: 'EXAMPLE.COM/A'
      })
    ).toEqual([
      WebhookDeliveryId.make('whd_admin_y'),
      WebhookDeliveryId.make('whd_admin_null_z')
    ])
    expect(
      yield* ids({ field: 'status', operator: 'is', value: 'DEAD_LETTERED' })
    ).toEqual([
      WebhookDeliveryId.make('whd_admin_z'),
      WebhookDeliveryId.make('whd_admin_null_z')
    ])
    expect(
      yield* ids({ field: 'workspace', operator: 'is', value: 'LIVE LAB' })
    ).toEqual([
      WebhookDeliveryId.make('whd_admin_z'),
      WebhookDeliveryId.make('whd_admin_null_a')
    ])
    // Ordering never matches an empty value; a range's negation does.
    expect(
      yield* ids({ field: 'lastAttemptAt', operator: 'before', value: '2027-01-01' })
    ).toEqual([
      WebhookDeliveryId.make('whd_admin_z'),
      WebhookDeliveryId.make('whd_admin_y')
    ])
    expect(
      yield* ids({
        field: 'lastAttemptAt',
        operator: 'isNot',
        value: '2026-09-01T00:00:00.000Z',
        endValue: '2026-09-01T23:59:59.999Z'
      })
    ).toEqual([
      WebhookDeliveryId.make('whd_admin_null_z'),
      WebhookDeliveryId.make('whd_admin_null_a')
    ])
    expect(
      yield* ids({ field: 'lastAttemptAt', operator: 'isEmpty', value: '' })
    ).toEqual([
      WebhookDeliveryId.make('whd_admin_null_z'),
      WebhookDeliveryId.make('whd_admin_null_a')
    ])

    // The parameter worst case: every filter a two-parameter range and every
    // sort resumed from a cursor, paged one row at a time.
    const widest: DeliveryView = {
      match: 'all',
      filters: Array.from({ length: deliveryViewLimits.filters }, () => ({
        field: 'lastAttemptAt',
        operator: 'is',
        value: '2026-01-01T00:00:00.000Z',
        endValue: '2026-12-31T23:59:59.999Z'
      })),
      sorts: [
        { field: 'attempts', direction: 'desc' },
        { field: 'workspace', direction: 'asc' },
        { field: 'endpointUrl', direction: 'asc' },
        { field: 'eventType', direction: 'asc' },
        { field: 'status', direction: 'asc' },
        { field: 'lastAttemptAt', direction: 'desc' }
      ]
    }
    expect(widest.sorts).toHaveLength(deliveryViewLimits.sorts)
    const walk = yield* walkKeysetPages(
      (input) => webhooks.listGlobalDeliveries({ ...input, view: widest }),
      { limit: 1 }
    )
    expect(walk.exhausted).toBe(true)
    expect(walk.items.map((row) => row.id)).toEqual([
      WebhookDeliveryId.make('whd_admin_z'),
      WebhookDeliveryId.make('whd_admin_y')
    ])
  })
}
