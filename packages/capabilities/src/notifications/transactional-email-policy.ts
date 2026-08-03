import type {
  EmailProviderSubmission,
  TransactionalEmailLocale,
  TransactionalEmailProviderState
} from './transactional-email-provider.ts'

export const ownerActivationTemplates = {
  ro: {
    key: 'owner_activation_test_ro_v1',
    subject: 'Test BeeSolo de e-mail tranzacțional',
    text: 'E-mailul tranzacțional BeeSolo este configurat pentru afacerea ta.'
  },
  en: {
    key: 'owner_activation_test_en_v1',
    subject: 'BeeSolo transactional email test',
    text: 'BeeSolo transactional email is configured for your business.'
  }
} as const satisfies Record<
  TransactionalEmailLocale,
  { readonly key: string; readonly subject: string; readonly text: string }
>

const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const normalizeOwnerEmail = (email: string) => {
  const destination = email.trim().toLowerCase()
  return validEmail.test(destination) ? destination : null
}

export const maskEmail = (email: string) => {
  const [local = '', domain = ''] = email.split('@')
  return `${local.slice(0, 1)}••••@${domain}`
}

type EvidenceBase = {
  readonly evidenceId: string
  readonly merchantId: string
  readonly locale: TransactionalEmailLocale
  readonly templateKey: string
  readonly maskedDestination: string
  readonly attemptedAt: string
  readonly attemptCount: number
}

export const evidenceFromSubmission = (
  base: EvidenceBase,
  result: EmailProviderSubmission
) =>
  result._tag === 'captured'
    ? ({ ...base, status: 'captured', retryable: false } as const)
    : result._tag === 'accepted'
      ? ({
          ...base,
          status: 'accepted',
          acceptedAt: result.acceptedAt,
          retryable: false
        } as const)
      : result._tag === 'submission_unknown'
        ? ({
            ...base,
            status: 'submission_unknown',
            failureCode: result.code,
            retryable: false
          } as const)
        : ({
            ...base,
            status: 'failed',
            failureCode: result.code,
            retryable: result.retryable
          } as const)

export const submissionPersistence = (result: EmailProviderSubmission) => ({
  status:
    result._tag === 'captured'
      ? ('captured' as const)
      : result._tag === 'accepted'
        ? ('accepted' as const)
        : result._tag === 'submission_unknown'
          ? ('submission_unknown' as const)
          : ('failed' as const),
  providerReferenceFingerprint:
    result._tag === 'accepted' ? result.providerReferenceFingerprint : null,
  acceptedAt: result._tag === 'accepted' ? result.acceptedAt : null,
  failureCode:
    result._tag === 'failed' || result._tag === 'submission_unknown'
      ? result.code
      : null,
  retryable: result._tag === 'failed' && result.retryable
})

type ReadinessEvidence = {
  readonly evidenceId: string
  readonly status:
    | 'submitting'
    | 'captured'
    | 'accepted'
    | 'delivered'
    | 'failed'
    | 'submission_unknown'
  readonly failureCode?: string | undefined
}

export const readinessFromEvidence = (
  merchantId: string,
  providerState: TransactionalEmailProviderState,
  evidence?: ReadinessEvidence
) => {
  if (providerState === 'needs_configuration' || providerState === 'disabled')
    return {
      merchantId,
      state: providerState,
      reason: `email_${providerState}`
    } as const
  if (!evidence) return { merchantId, state: 'not_tested' } as const
  if (evidence.status === 'accepted' || evidence.status === 'delivered')
    return {
      merchantId,
      state: 'ready',
      acceptedEvidenceId: evidence.evidenceId
    } as const
  if (evidence.status === 'failed' || evidence.status === 'submission_unknown')
    return {
      merchantId,
      state: 'failed',
      reason: evidence.failureCode ?? evidence.status
    } as const
  return { merchantId, state: 'not_tested' } as const
}
