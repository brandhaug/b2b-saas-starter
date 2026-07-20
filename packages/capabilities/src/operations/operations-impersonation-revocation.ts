import type { ImpersonationRevocationCause } from './operations-impersonation-lifecycle.ts'

export type ImpersonationRevocationStatement = {
  readonly sql: string
  readonly params: readonly unknown[]
}

export type ActiveImpersonationSelector =
  | { readonly operatorId: string; readonly exceptOperatorSessionId?: string }
  | { readonly operatorSessionId: string }
  | { readonly merchantSessionId: string }

const selectorSql = (selector: ActiveImpersonationSelector) => {
  if ('operatorSessionId' in selector) {
    return {
      clause: 'record.operator_session_id = ?',
      params: [selector.operatorSessionId] as readonly unknown[]
    }
  }
  if ('merchantSessionId' in selector) {
    return {
      clause: 'record.merchant_session_id = ?',
      params: [selector.merchantSessionId] as readonly unknown[]
    }
  }
  return {
    clause: `record.operator_id = ?${selector.exceptOperatorSessionId ? ' AND record.operator_session_id <> ?' : ''}`,
    params: [
      selector.operatorId,
      ...(selector.exceptOperatorSessionId ? [selector.exceptOperatorSessionId] : [])
    ] as readonly unknown[]
  }
}

const withSequentialParameters = (
  sql: string,
  params: readonly unknown[]
): ImpersonationRevocationStatement => {
  let index = 0
  return {
    sql: sql.replaceAll('?', () => `?${++index}`),
    params
  }
}

export const activeImpersonationRevocationStatements = (input: {
  readonly selector: ActiveImpersonationSelector
  readonly cause: ImpersonationRevocationCause
  readonly occurredAt: Date
  readonly securityContact: string
  readonly requireAuditEventId?: string
}): readonly ImpersonationRevocationStatement[] => {
  const selector = selectorSql(input.selector)
  const occurredAt = input.occurredAt.toISOString()
  const occurredAtEpoch = Math.floor(input.occurredAt.getTime() / 1_000)
  const auditGuard = input.requireAuditEventId
    ? ' AND EXISTS (SELECT 1 FROM audit_events WHERE id = ?)'
    : ''
  const selectorParams = [
    ...selector.params,
    ...(input.requireAuditEventId ? [input.requireAuditEventId] : [])
  ]
  const transitioned = `${selector.clause}
      AND record.lifecycle = 'revoked'
      AND record.termination_cause = ?
      AND record.terminal_at = ?
      AND record.updated_at = ?`
  const transitionedParams = [
    ...selector.params,
    input.cause,
    occurredAtEpoch,
    occurredAt
  ]

  return [
    withSequentialParameters(
      `UPDATE impersonation_records AS record
       SET lifecycle = 'revoked', terminal_at = ?, termination_cause = ?, updated_at = ?
       WHERE record.lifecycle = 'active' AND ${selector.clause}${auditGuard}`,
      [occurredAtEpoch, input.cause, occurredAt, ...selectorParams]
    ),
    withSequentialParameters(
      `UPDATE session
       SET expiresAt = ?, updatedAt = ?
       WHERE id IN (
         SELECT record.merchant_session_id
         FROM impersonation_records AS record
         WHERE ${transitioned}
       )`,
      [occurredAtEpoch, occurredAtEpoch, ...transitionedParams]
    ),
    withSequentialParameters(
      `INSERT INTO operations_notification_intents (
         id, impersonation_id, event_type, recipient_email,
         merchant_id, merchant_name, occurred_at, support_reference,
         security_contact, payload_json, status, available_at,
         created_at, updated_at
       )
       SELECT 'opnti_' || record.id || '_revoked', record.id,
              'impersonation-revoked', target.email, record.merchant_id,
              coalesce(merchant.public_name, record.merchant_id), ?,
              record.support_reference, ?,
              json_object(
                'merchant', coalesce(merchant.public_name, record.merchant_id),
                'timestamp', ?,
                'supportReference', record.support_reference,
                'securityContact', ?
              ),
              'pending', ?, ?, ?
       FROM impersonation_records AS record
       JOIN user AS target ON target.id = record.target_member_id
       LEFT JOIN merchants AS merchant ON merchant.id = record.merchant_id
       WHERE ${transitioned}
       ON CONFLICT(id) DO NOTHING`,
      [
        occurredAt,
        input.securityContact.trim(),
        occurredAt,
        input.securityContact.trim(),
        occurredAt,
        occurredAt,
        occurredAt,
        ...transitionedParams
      ]
    ),
    withSequentialParameters(
      `INSERT INTO operations_audit_events (
         id, business_event_id, actor_operator_id, actor_display_name,
         operator_session_id, impersonation_id, target_id,
         target_display_name, merchant_id, merchant_display_name,
         action, result, occurred_at, retention_policy, retain_until,
         internal_reason, support_reference, created_at
       )
       SELECT 'oaud_' || record.id || '_revoked',
              'impersonation:' || record.id || ':revoked',
              record.operator_id, coalesce(operator.name, record.operator_id),
              record.operator_session_id, record.id, record.target_member_id,
              coalesce(target.name, record.target_member_id), record.merchant_id,
              coalesce(merchant.public_name, record.merchant_id),
              'impersonation.revoked', 'accepted', ?,
              'impersonation-two-years', ?, record.reason,
              record.support_reference, ?
       FROM impersonation_records AS record
       LEFT JOIN user AS operator ON operator.id = record.operator_id
       LEFT JOIN user AS target ON target.id = record.target_member_id
       LEFT JOIN merchants AS merchant ON merchant.id = record.merchant_id
       WHERE ${transitioned}
       ON CONFLICT(business_event_id) DO NOTHING`,
      [
        occurredAt,
        new Date(
          Date.UTC(
            input.occurredAt.getUTCFullYear() + 2,
            input.occurredAt.getUTCMonth(),
            input.occurredAt.getUTCDate(),
            input.occurredAt.getUTCHours(),
            input.occurredAt.getUTCMinutes(),
            input.occurredAt.getUTCSeconds(),
            input.occurredAt.getUTCMilliseconds()
          )
        ).toISOString(),
        occurredAt,
        ...transitionedParams
      ]
    )
  ]
}
