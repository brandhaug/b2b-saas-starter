import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'
import { newCapabilityId } from '../internal/ids.ts'
import { NEW_DEMAND_SUBSCRIPTION_SQL_VALUES } from '../subscriptions/subscription-access.ts'

type ScheduleMutation = {
  readonly merchantId: string
  readonly serviceId: string
  readonly actorId: string
  readonly occurredAt: string
}

export const serviceConfigurationScheduleConsequences = (
  d1: D1Database,
  input: ScheduleMutation & {
    readonly before: { readonly durationMinutes: number; readonly status: string }
    readonly after: { readonly durationMinutes: number; readonly status: string }
  }
): readonly D1PreparedStatement[] => {
  const changed =
    input.before.durationMinutes !== input.after.durationMinutes ||
    input.before.status !== input.after.status
  return [
    d1
      .prepare(
        `WITH changed(service_id,duration_minutes,status) AS (VALUES (?,?,?)),
         candidates AS (
           SELECT h.id,h.provider_id,h.starts_at,h.quote,
             (SELECT sum(CASE
               WHEN json_extract(item.value,'$.id')=changed.service_id
                 THEN changed.duration_minutes
               ELSE json_extract(item.value,'$.durationMinutes') END)
              FROM json_each(h.quote,'$.services') item) new_duration
           FROM time_slot_holds h CROSS JOIN changed
           WHERE h.merchant_id=? AND h.expires_at>? AND ?=1
             AND EXISTS (SELECT 1 FROM json_each(h.quote,'$.services') item
               WHERE json_extract(item.value,'$.id')=changed.service_id)
             AND EXISTS (SELECT 1 FROM services s
               WHERE s.id=changed.service_id AND s.merchant_id=? AND s.updated_at=?)
             AND EXISTS (SELECT 1 FROM merchant_subscriptions subscription
               WHERE subscription.merchant_id=?
                 AND subscription.status IN (${NEW_DEMAND_SUBSCRIPTION_SQL_VALUES})))
         DELETE FROM time_slot_holds WHERE id IN (
           SELECT c.id FROM candidates c WHERE
             ?='inactive'
             OR c.new_duration IS NULL
             OR json_extract(c.quote,'$.localStartTime') IS NULL
             OR json_extract(c.quote,'$.workingIntervalStartTime') IS NULL
             OR json_extract(c.quote,'$.workingIntervalEndTime') IS NULL
             OR json_extract(c.quote,'$.occupiedStartsAt') IS NULL
             OR ((CAST(substr(json_extract(c.quote,'$.localStartTime'),1,2) AS INTEGER)*60
               + CAST(substr(json_extract(c.quote,'$.localStartTime'),4,2) AS INTEGER))
               + c.new_duration + COALESCE(json_extract(c.quote,'$.afterBufferMinutes'),0))
               > (CAST(substr(json_extract(c.quote,'$.workingIntervalEndTime'),1,2) AS INTEGER)*60
                 + CAST(substr(json_extract(c.quote,'$.workingIntervalEndTime'),4,2) AS INTEGER))
             OR EXISTS (SELECT 1 FROM blocked_times b WHERE b.merchant_id=?
               AND b.starts_at < strftime('%Y-%m-%dT%H:%M:%fZ',c.starts_at,
                 '+'||c.new_duration||' minutes',
                 '+'||COALESCE(json_extract(c.quote,'$.afterBufferMinutes'),0)||' minutes')
               AND b.ends_at > json_extract(c.quote,'$.occupiedStartsAt'))
             OR EXISTS (SELECT 1 FROM appointments a
               WHERE a.provider_id=c.provider_id AND a.status='scheduled'
                 AND COALESCE(json_extract(a.snapshot,'$.occupiedStartsAt'),a.starts_at)
                   < strftime('%Y-%m-%dT%H:%M:%fZ',c.starts_at,
                     '+'||c.new_duration||' minutes',
                     '+'||COALESCE(json_extract(c.quote,'$.afterBufferMinutes'),0)||' minutes')
                 AND COALESCE(json_extract(a.snapshot,'$.occupiedEndsAt'),a.ends_at)
                   > json_extract(c.quote,'$.occupiedStartsAt'))
             OR EXISTS (SELECT 1 FROM time_slot_holds other
               WHERE other.id<>c.id AND other.provider_id=c.provider_id
                 AND other.expires_at>?
                 AND COALESCE(json_extract(other.quote,'$.occupiedStartsAt'),other.starts_at)
                   < strftime('%Y-%m-%dT%H:%M:%fZ',c.starts_at,
                     '+'||c.new_duration||' minutes',
                     '+'||COALESCE(json_extract(c.quote,'$.afterBufferMinutes'),0)||' minutes')
                 AND COALESCE(json_extract(other.quote,'$.occupiedEndsAt'),other.ends_at)
                   > json_extract(c.quote,'$.occupiedStartsAt')))`
      )
      .bind(
        input.serviceId,
        input.after.durationMinutes,
        input.after.status,
        input.merchantId,
        input.occurredAt,
        changed ? 1 : 0,
        input.merchantId,
        input.occurredAt,
        input.merchantId,
        input.after.status,
        input.merchantId,
        input.occurredAt
      ),
    d1
      .prepare(
        `INSERT INTO schedule_changes
         (id,merchant_id,kind,actor_id,reason,before_json,after_json,occurred_at)
         SELECT ?,?,'service_configuration',?,NULL,?,?,?
         WHERE ?=1 AND EXISTS (SELECT 1 FROM services
           WHERE id=? AND merchant_id=? AND updated_at=?)
         AND EXISTS (SELECT 1 FROM merchant_subscriptions subscription
           WHERE subscription.merchant_id=?
             AND subscription.status IN (${NEW_DEMAND_SUBSCRIPTION_SQL_VALUES}))`
      )
      .bind(
        newCapabilityId('scg'),
        input.merchantId,
        input.actorId,
        JSON.stringify(input.before),
        JSON.stringify(input.after),
        input.occurredAt,
        changed ? 1 : 0,
        input.serviceId,
        input.merchantId,
        input.occurredAt,
        input.merchantId
      )
  ]
}

export const serviceEligibilityScheduleChange = (
  d1: D1Database,
  input: ScheduleMutation & {
    readonly beforeProviderIds: readonly string[]
    readonly afterProviderIds: readonly string[]
  }
): {
  readonly changeId: string
  readonly fact: D1PreparedStatement
  readonly invalidateHolds: D1PreparedStatement
} => {
  const changeId = newCapabilityId('scg')
  return {
    changeId,
    fact: d1
      .prepare(
        `INSERT INTO schedule_changes
         (id,merchant_id,kind,actor_id,reason,before_json,after_json,occurred_at)
         SELECT ?,?,'service_eligibility',?,NULL,?,?,? WHERE EXISTS (
           SELECT 1 FROM services WHERE id=? AND merchant_id=? AND status='inactive')
         AND EXISTS (SELECT 1 FROM merchant_subscriptions subscription
           WHERE subscription.merchant_id=?
             AND subscription.status IN (${NEW_DEMAND_SUBSCRIPTION_SQL_VALUES}))
         AND NOT EXISTS (SELECT 1 FROM provider_service_eligibility current
           WHERE current.merchant_id=? AND current.service_id=?
             AND NOT EXISTS (SELECT 1 FROM json_each(?) expected
               WHERE expected.value=current.provider_id))
         AND NOT EXISTS (SELECT 1 FROM json_each(?) expected
           WHERE NOT EXISTS (SELECT 1 FROM provider_service_eligibility current
             WHERE current.merchant_id=? AND current.service_id=?
               AND current.provider_id=expected.value))`
      )
      .bind(
        changeId,
        input.merchantId,
        input.actorId,
        JSON.stringify({ providerIds: input.beforeProviderIds }),
        JSON.stringify({ providerIds: input.afterProviderIds }),
        input.occurredAt,
        input.serviceId,
        input.merchantId,
        input.merchantId,
        input.merchantId,
        input.serviceId,
        JSON.stringify(input.beforeProviderIds),
        JSON.stringify(input.beforeProviderIds),
        input.merchantId,
        input.serviceId
      ),
    invalidateHolds: d1
      .prepare(
        `DELETE FROM time_slot_holds AS h WHERE h.merchant_id=?
         AND h.expires_at>? AND EXISTS (
           SELECT 1 FROM json_each(h.quote,'$.services') item
           WHERE json_extract(item.value,'$.id')=?)
         AND NOT EXISTS (SELECT 1 FROM json_each(?) requested
           WHERE requested.value=h.provider_id)
         AND EXISTS (SELECT 1 FROM schedule_changes WHERE id=?)`
      )
      .bind(
        input.merchantId,
        input.occurredAt,
        input.serviceId,
        JSON.stringify(input.afterProviderIds),
        changeId
      )
  }
}

export const serviceBufferScheduleConsequences = (
  d1: D1Database,
  input: ScheduleMutation & {
    readonly before: unknown
    readonly after: {
      readonly beforeBufferMinutes: number
      readonly afterBufferMinutes: number
    }
  }
): readonly D1PreparedStatement[] => [
  d1
    .prepare(
      `WITH changed(service_id,before_minutes,after_minutes) AS (VALUES (?,?,?)),
       candidates AS (
         SELECT h.id,h.provider_id,h.starts_at,h.ends_at,h.quote,
           (SELECT max(CASE WHEN json_extract(item.value,'$.id')=changed.service_id
             THEN changed.before_minutes ELSE COALESCE(json_extract(item.value,'$.beforeBufferMinutes'),0) END)
             FROM json_each(h.quote,'$.services') item) new_before,
           (SELECT max(CASE WHEN json_extract(item.value,'$.id')=changed.service_id
             THEN changed.after_minutes ELSE COALESCE(json_extract(item.value,'$.afterBufferMinutes'),0) END)
             FROM json_each(h.quote,'$.services') item) new_after
         FROM time_slot_holds h CROSS JOIN changed
         WHERE h.merchant_id=? AND h.expires_at>?
           AND EXISTS (SELECT 1 FROM json_each(h.quote,'$.services') item
             WHERE json_extract(item.value,'$.id')=changed.service_id)
           AND EXISTS (SELECT 1 FROM services s WHERE s.id=changed.service_id
             AND s.merchant_id=? AND s.updated_at=?)
           AND EXISTS (SELECT 1 FROM merchant_subscriptions subscription
             WHERE subscription.merchant_id=?
               AND subscription.status IN (${NEW_DEMAND_SUBSCRIPTION_SQL_VALUES})))
       DELETE FROM time_slot_holds WHERE id IN (
         SELECT c.id FROM candidates c WHERE
           json_extract(c.quote,'$.workingIntervalStartTime') IS NULL
           OR ((CAST(substr(json_extract(c.quote,'$.localStartTime'),1,2) AS INTEGER)*60
             + CAST(substr(json_extract(c.quote,'$.localStartTime'),4,2) AS INTEGER)) - c.new_before)
             < (CAST(substr(json_extract(c.quote,'$.workingIntervalStartTime'),1,2) AS INTEGER)*60
               + CAST(substr(json_extract(c.quote,'$.workingIntervalStartTime'),4,2) AS INTEGER))
           OR ((CAST(substr(json_extract(c.quote,'$.localStartTime'),1,2) AS INTEGER)*60
             + CAST(substr(json_extract(c.quote,'$.localStartTime'),4,2) AS INTEGER))
             + COALESCE(json_extract(c.quote,'$.durationMinutes'),0) + c.new_after)
             > (CAST(substr(json_extract(c.quote,'$.workingIntervalEndTime'),1,2) AS INTEGER)*60
               + CAST(substr(json_extract(c.quote,'$.workingIntervalEndTime'),4,2) AS INTEGER))
           OR EXISTS (SELECT 1 FROM blocked_times b WHERE b.merchant_id=?
             AND b.starts_at < strftime('%Y-%m-%dT%H:%M:%fZ',c.ends_at,'+'||c.new_after||' minutes')
             AND b.ends_at > strftime('%Y-%m-%dT%H:%M:%fZ',c.starts_at,'-'||c.new_before||' minutes'))
           OR EXISTS (SELECT 1 FROM appointments a WHERE a.provider_id=c.provider_id AND a.status='scheduled'
             AND COALESCE(json_extract(a.snapshot,'$.occupiedStartsAt'),a.starts_at) < strftime('%Y-%m-%dT%H:%M:%fZ',c.ends_at,'+'||c.new_after||' minutes')
             AND COALESCE(json_extract(a.snapshot,'$.occupiedEndsAt'),a.ends_at) > strftime('%Y-%m-%dT%H:%M:%fZ',c.starts_at,'-'||c.new_before||' minutes'))
           OR EXISTS (SELECT 1 FROM time_slot_holds other WHERE other.id<>c.id
             AND other.provider_id=c.provider_id AND other.expires_at>?
             AND COALESCE(json_extract(other.quote,'$.occupiedStartsAt'),other.starts_at) < strftime('%Y-%m-%dT%H:%M:%fZ',c.ends_at,'+'||c.new_after||' minutes')
             AND COALESCE(json_extract(other.quote,'$.occupiedEndsAt'),other.ends_at) > strftime('%Y-%m-%dT%H:%M:%fZ',c.starts_at,'-'||c.new_before||' minutes')))`
    )
    .bind(
      input.serviceId,
      input.after.beforeBufferMinutes,
      input.after.afterBufferMinutes,
      input.merchantId,
      input.occurredAt,
      input.merchantId,
      input.occurredAt,
      input.merchantId,
      input.merchantId,
      input.occurredAt
    ),
  d1
    .prepare(
      `INSERT INTO schedule_changes
       (id,merchant_id,kind,actor_id,reason,before_json,after_json,occurred_at)
       SELECT ?,?,'service_buffers',?,NULL,?,?,? WHERE EXISTS (
         SELECT 1 FROM services WHERE id=? AND merchant_id=? AND updated_at=?)
       AND EXISTS (SELECT 1 FROM merchant_subscriptions subscription
         WHERE subscription.merchant_id=?
           AND subscription.status IN (${NEW_DEMAND_SUBSCRIPTION_SQL_VALUES}))`
    )
    .bind(
      newCapabilityId('scg'),
      input.merchantId,
      input.actorId,
      JSON.stringify(input.before),
      JSON.stringify(input.after),
      input.occurredAt,
      input.serviceId,
      input.merchantId,
      input.occurredAt,
      input.merchantId
    )
]
