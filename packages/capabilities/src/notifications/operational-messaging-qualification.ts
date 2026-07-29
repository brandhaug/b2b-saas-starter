import { Effect, Schema } from 'effect'

const nonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const OperationalMessagingQualificationRun = Schema.Struct({
  produced: nonNegativeInt,
  submitted: nonNegativeInt,
  terminal: nonNegativeInt,
  firstSubmissionWithin60Seconds: nonNegativeInt,
  platformDuplicateSubmissions: nonNegativeInt,
  duplicateCharges: nonNegativeInt,
  ledgerVarianceMilliEuro: Schema.Int,
  queueOutageRecovered: Schema.Boolean,
  drainMinutes: nonNegativeInt,
  bookingSucceeded: Schema.Boolean,
  emailSucceeded: Schema.Boolean
})
export type QualificationRun = typeof OperationalMessagingQualificationRun.Type

export class QualificationEvidenceInvalid extends Schema.TaggedErrorClass<QualificationEvidenceInvalid>()(
  'QualificationEvidenceInvalid',
  { reason: Schema.Literals(['malformed_json', 'invalid_shape']) }
) {}

export const decodeQualificationEvidence = (
  raw: string
): Effect.Effect<QualificationRun, QualificationEvidenceInvalid> =>
  Effect.gen(function* () {
    const json = yield* Effect.try({
      try: () => JSON.parse(raw) as unknown,
      catch: () => new QualificationEvidenceInvalid({ reason: 'malformed_json' })
    })
    return yield* Schema.decodeUnknownEffect(OperationalMessagingQualificationRun)(
      json
    ).pipe(
      Effect.mapError(
        () => new QualificationEvidenceInvalid({ reason: 'invalid_shape' })
      )
    )
  })

export const qualificationProfile = {
  merchants: 100,
  submissionsPerMerchantPerMinute: 20,
  durationMinutes: 30,
  totalExpectedSubmissions: 60_000,
  queueOutageMinutes: 15,
  recoveryScanMinutes: 5,
  maximumDrainMinutes: 15,
  minimumImmediateSubmissionRatio: 0.99
} as const

export const evaluateQualificationRun = (run: QualificationRun) => {
  const blockers: string[] = []
  if (run.produced !== qualificationProfile.totalExpectedSubmissions)
    blockers.push('load_profile_incomplete')
  if (run.submitted !== run.produced) blockers.push('lost_or_unsubmitted_intents')
  if (run.terminal !== run.produced) blockers.push('nonterminal_intents')
  if (
    run.produced === 0 ||
    run.firstSubmissionWithin60Seconds / run.produced <
      qualificationProfile.minimumImmediateSubmissionRatio
  )
    blockers.push('immediate_submission_slo_failed')
  if (run.platformDuplicateSubmissions !== 0)
    blockers.push('platform_duplicate_submission')
  if (run.duplicateCharges !== 0) blockers.push('duplicate_merchant_charge')
  if (run.ledgerVarianceMilliEuro !== 0) blockers.push('ledger_variance')
  if (!run.queueOutageRecovered) blockers.push('queue_outage_not_recovered')
  if (run.drainMinutes > qualificationProfile.maximumDrainMinutes)
    blockers.push('queue_drain_exceeded_15_minutes')
  if (!run.bookingSucceeded) blockers.push('booking_isolation_failed')
  if (!run.emailSucceeded) blockers.push('email_isolation_failed')
  return { state: blockers.length === 0 ? 'passed' : 'blocked', blockers } as const
}

export type MessagingMetrics = {
  readonly eligibleIntents: number
  readonly deliveredWithin15Minutes: number
  readonly immediateIntents: number
  readonly immediateSubmittedWithin60Seconds: number
  readonly remindersDue: number
  readonly remindersSubmittedWithin5Minutes: number
  readonly eligibleFallbacks: number
  readonly fallbacksSubmittedWithin60Seconds: number
  readonly verifiedDeliveries7d: number
  readonly complaints7d: number
  readonly providerCostMilliEuro: number
  readonly duplicateCharges: number
  readonly negativeBalances: number
  readonly unexplainedReconciliationVariances: number
  readonly duplicateDeliveries: number
  readonly unauthorizedDeliveries: number
}

type MessagingAlert = {
  readonly code: string
  readonly severity: 'warning' | 'critical'
  readonly observed: number
  readonly threshold: number
}

const slo = {
  delivery15m: 0.98,
  immediate60s: 0.99,
  reminder5m: 0.99,
  fallback60s: 0.99,
  complaintWarning: 0.005,
  complaintCritical: 0.01,
  complaintMinimum: 200,
  providerCostWarning: 36,
  providerCostCritical: 45
} as const

const belowRatio = (
  alerts: MessagingAlert[],
  code: string,
  numerator: number,
  denominator: number,
  threshold: number
) => {
  if (denominator === 0) return
  const observed = numerator / denominator
  if (observed < threshold)
    alerts.push({ code, severity: 'warning', observed, threshold })
}

export const evaluateMessagingAlerts = (
  metrics: MessagingMetrics
): MessagingAlert[] => {
  const alerts: MessagingAlert[] = []
  belowRatio(
    alerts,
    'delivery_15m_slo',
    metrics.deliveredWithin15Minutes,
    metrics.eligibleIntents,
    slo.delivery15m
  )
  belowRatio(
    alerts,
    'immediate_submission_slo',
    metrics.immediateSubmittedWithin60Seconds,
    metrics.immediateIntents,
    slo.immediate60s
  )
  belowRatio(
    alerts,
    'reminder_submission_slo',
    metrics.remindersSubmittedWithin5Minutes,
    metrics.remindersDue,
    slo.reminder5m
  )
  belowRatio(
    alerts,
    'fallback_submission_slo',
    metrics.fallbacksSubmittedWithin60Seconds,
    metrics.eligibleFallbacks,
    slo.fallback60s
  )
  if (metrics.verifiedDeliveries7d >= slo.complaintMinimum) {
    const observed = metrics.complaints7d / metrics.verifiedDeliveries7d
    if (observed > slo.complaintCritical)
      alerts.push({
        code: 'complaint_rate_critical',
        severity: 'critical',
        observed,
        threshold: slo.complaintCritical
      })
    else if (observed > slo.complaintWarning)
      alerts.push({
        code: 'complaint_rate_warning',
        severity: 'warning',
        observed,
        threshold: slo.complaintWarning
      })
  }
  if (metrics.providerCostMilliEuro >= slo.providerCostCritical)
    alerts.push({
      code: 'provider_cost_critical',
      severity: 'critical',
      observed: metrics.providerCostMilliEuro,
      threshold: slo.providerCostCritical
    })
  else if (metrics.providerCostMilliEuro > slo.providerCostWarning)
    alerts.push({
      code: 'provider_cost_warning',
      severity: 'warning',
      observed: metrics.providerCostMilliEuro,
      threshold: slo.providerCostWarning
    })
  for (const [code, observed] of [
    ['duplicate_charge', metrics.duplicateCharges],
    ['negative_balance', metrics.negativeBalances],
    ['reconciliation_variance', metrics.unexplainedReconciliationVariances],
    ['duplicate_delivery', metrics.duplicateDeliveries],
    ['unauthorized_delivery', metrics.unauthorizedDeliveries]
  ] as const)
    if (observed > 0)
      alerts.push({ code, severity: 'critical', observed, threshold: 0 })
  return alerts
}
