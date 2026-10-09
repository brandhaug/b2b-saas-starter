// Telemetry accepts unknown SDK values. Only primitive, explicitly allowed fields leave this module.
// oxlint-disable anti-slop/no-runtime-typeof

const OMITTED = '[omitted]'

/** Code-owned labels only. URLs, query strings, whitespace and email addresses are rejected. */
export function diagnosticLabel(value: unknown): string {
  if (typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_.-]{0,119}$/.test(value)) {
    return value
  }
  return OMITTED
}

const countFields = new Set([
  'unreadCount',
  'failedConversations',
  'cleanedConversations',
  'expiredReservations',
  'assistantAffectedConversations',
  'notificationEmailRecipients',
  'notificationEmailEnqueued'
])

const publicationFailureFields = new Set([
  'webhookPublish',
  'webhookDeadLetterNotification',
  'seatSyncPublish',
  'notificationEmailEnqueue'
])

const allowedFields = new Set([
  ...countFields,
  ...publicationFailureFields,
  'assistantAuthorityNotification',
  'service',
  'event',
  'status',
  'outcome',
  'errorKind',
  'errorTag',
  'errorSummary',
  'environment',
  'region',
  'serviceVersion',
  'commitHash',
  'method',
  'handlerType',
  'scope',
  'traceId',
  'otelTraceId',
  'otelSpanId',
  'spanId',
  'workspaceId',
  'subjectId',
  'targetId',
  'eventType',
  'operation',
  'capability',
  'reason',
  'auditOperation',
  'auditCapability',
  'auditFailureReason',
  'exportId',
  'deliveryId',
  'endpointId',
  'webhookEndpointId',
  'jobId',
  'evidenceId',
  'evidenceKind',
  'queue',
  'skipReason',
  'messageId',
  'attempts',
  'ageMs',
  'rateLimitDegraded',
  'rateLimitFallback',
  'rateLimitBucket',
  'durationMs',
  'statusCode',
  'sizeBytes',
  'count',
  'attempt',
  'quantity',
  'authenticated',
  'credential',
  'authReason',
  'authAuditBodyErrorTag',
  'plan',
  'signal',
  'service.name',
  'service.version',
  'event.name',
  'cloud.provider',
  'deployment.environment.name',
  'vcs.ref.head.revision',
  'outcome.status',
  'duration.ms',
  'http.request.method',
  'http.response.status_code',
  'exception.type',
  'status.interrupted',
  'fiberId'
])

const SUMMARY_MAX_LENGTH = 120
// `at <fn> (<file>:<line>:<col>)`, or the bare `at <file>:<line>:<col>` form.
const STACK_FRAME = /^at (?:.*\()?([^()\s]+):(\d+):(\d+)\)?$/
// A source file name, after the directories are dropped. No query strings, no
// data URLs, nothing that could carry a value.
const SAFE_FRAME_FILE = /^[a-zA-Z0-9_.-]{1,80}$/

function topFrame(line: string): string | undefined {
  const match = STACK_FRAME.exec(line.trim())
  if (match === null) {
    return undefined
  }
  const file = match[1]?.split(/[/\\]/).at(-1) ?? ''
  if (!SAFE_FRAME_FILE.test(file)) {
    return undefined
  }
  return `${file}-${match[2]}-${match[3]}`
}

/**
 * What a defect is allowed to tell an error tracker: the thrown value's name
 * and the top stack frame, as `TypeError-queue-consumer.ts-118-9`.
 *
 * Deliberately NOT the message. A defect is any thrown value — including a
 * provider error whose text quotes the request that produced it — and no
 * syntactic rule separates `x is not a function` from a message carrying a
 * credential, so the message stays off the wire (ADR 0007). Name plus location
 * is what makes a defect findable, and it cannot carry customer data.
 *
 * The separator set is the one {@link diagnosticFields} accepts, so the
 * summary survives the scalar allowlist instead of being dropped by it.
 */
export function diagnosticErrorSummary(pretty: string): string | undefined {
  const lines = pretty.split('\n')
  const name = diagnosticLabel(lines[0]?.split(':')[0]?.trim())
  const frame = lines.map(topFrame).find((value) => value !== undefined)
  if (name === OMITTED && frame === undefined) {
    return undefined
  }
  if (frame === undefined) {
    return name.slice(0, SUMMARY_MAX_LENGTH)
  }
  return `${name}-${frame}`.slice(0, SUMMARY_MAX_LENGTH)
}

/** No recursion into arbitrary annotations: nested errors, headers and customer data are omitted. */
export function diagnosticFields(fields: object) {
  const result: Record<string, string | number | boolean> = {}
  for (const key of Object.keys(fields)) {
    const value: unknown = Object.getOwnPropertyDescriptor(fields, key)?.value
    if (key === 'handlerType' && value !== 'router' && value !== 'serverFn') {
      continue
    }
    if (key === 'scope' && value !== 'standalone') {
      continue
    }
    if (countFields.has(key) && typeof value !== 'number') {
      continue
    }
    if (publicationFailureFields.has(key) && value !== 'failed') {
      continue
    }
    if (key === 'authAuditBodyErrorTag' && value !== 'AuthAuditBodyUnreadable') {
      continue
    }
    if (key === 'assistantAuthorityNotification' && value !== 'host_unavailable') {
      continue
    }
    if (!allowedFields.has(key)) {
      continue
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      result[key] = value
    } else if (typeof value === 'boolean') {
      result[key] = value
    } else if (typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,120}$/.test(value)) {
      result[key] = value
    }
  }
  return result
}

/** The web request's known nested-run list gets the same scalar allowlist, one level only. */
export function diagnosticAnnotations(fields: Readonly<Record<string, unknown>>) {
  const safe = diagnosticFields(fields)
  if (!Array.isArray(fields['nested'])) {
    return safe
  }
  return {
    ...safe,
    nested: fields['nested'].flatMap((entry: unknown) => {
      if (typeof entry !== 'object' || entry === null) {
        return []
      }
      return [diagnosticFields(entry)]
    })
  }
}
