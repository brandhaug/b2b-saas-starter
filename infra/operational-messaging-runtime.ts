export const messagingSecretBindings = [
  'META_WHATSAPP_ACCESS_TOKEN',
  'META_WHATSAPP_APP_SECRET',
  'META_WHATSAPP_WEBHOOK_VERIFY_TOKEN',
  'META_WHATSAPP_REFERENCE_ENCRYPTION_KEY',
  'META_WHATSAPP_REFERENCE_FINGERPRINT_KEY',
  'SMSO_API_KEY',
  'SMSO_CALLBACK_URL',
  'SMSO_CALLBACK_PATH_SECRET',
  'SMSO_PROVIDER_REFERENCE_ENCRYPTION_KEY',
  'SMSO_PROVIDER_REFERENCE_FINGERPRINT_KEY',
  'OPERATIONAL_MESSAGING_DESTINATION_ENCRYPTION_KEY',
  'OPERATIONAL_MESSAGING_DESTINATION_FINGERPRINT_KEY'
] as const

type MessagingSecretBinding = (typeof messagingSecretBindings)[number]
type WorkerName = 'api' | 'background' | 'booking' | 'merchant' | 'operations' | 'web'

const allowedMessagingSecrets: Record<WorkerName, readonly MessagingSecretBinding[]> = {
  api: [
    'META_WHATSAPP_APP_SECRET',
    'META_WHATSAPP_WEBHOOK_VERIFY_TOKEN',
    'META_WHATSAPP_REFERENCE_FINGERPRINT_KEY',
    'SMSO_CALLBACK_PATH_SECRET',
    'SMSO_PROVIDER_REFERENCE_FINGERPRINT_KEY'
  ],
  background: [
    'META_WHATSAPP_ACCESS_TOKEN',
    'META_WHATSAPP_REFERENCE_ENCRYPTION_KEY',
    'META_WHATSAPP_REFERENCE_FINGERPRINT_KEY',
    'SMSO_API_KEY',
    'SMSO_CALLBACK_URL',
    'SMSO_PROVIDER_REFERENCE_ENCRYPTION_KEY',
    'SMSO_PROVIDER_REFERENCE_FINGERPRINT_KEY',
    'OPERATIONAL_MESSAGING_DESTINATION_ENCRYPTION_KEY',
    'OPERATIONAL_MESSAGING_DESTINATION_FINGERPRINT_KEY'
  ],
  booking: [
    'OPERATIONAL_MESSAGING_DESTINATION_ENCRYPTION_KEY',
    'OPERATIONAL_MESSAGING_DESTINATION_FINGERPRINT_KEY'
  ],
  merchant: [],
  operations: [],
  web: []
}

export const operationalMessagingRuntime = {
  qualification: {
    customerTrafficEnabled: false,
    requiredConfiguration: messagingSecretBindings
  },
  queue: {
    recoveryCron: '*/5 * * * *',
    envelopeVersionsAccepted: ['legacy-outbox', 1] as const
  },
  jobs: {
    ambiguityAlertAfterHours: 24,
    ambiguityCloseAfterDays: 7,
    reconciliationCron: '*/5 * * * *',
    retentionCron: '*/5 * * * *'
  }
} as const

export const validateMessagingBindingAuthority = (
  bindings: Record<WorkerName, readonly string[]>
): string[] => {
  const secretSet = new Set<string>(messagingSecretBindings)
  return (Object.keys(bindings) as WorkerName[]).flatMap((worker) => {
    const allowed = new Set<string>(allowedMessagingSecrets[worker])
    return bindings[worker]
      .filter((binding) => secretSet.has(binding) && !allowed.has(binding))
      .map((binding) => `${worker} must not receive ${binding}`)
  })
}

export const validateQualificationConfiguration = (input: {
  readonly deployment: string
  readonly customerTrafficEnabled: boolean
  readonly configured: readonly string[]
}) => {
  const configured = new Set(input.configured)
  const missing =
    operationalMessagingRuntime.qualification.requiredConfiguration.filter(
      (name) => !configured.has(name)
    )
  const violations: string[] = []
  if (input.deployment !== 'qualification')
    violations.push('qualification_environment_must_be_explicit')
  if (input.customerTrafficEnabled)
    violations.push('qualification_customer_traffic_must_be_disabled')

  for (const [name, members] of [
    [
      'meta_submission_configuration_must_be_complete',
      [
        'META_WHATSAPP_ACCESS_TOKEN',
        'META_WHATSAPP_REFERENCE_ENCRYPTION_KEY',
        'META_WHATSAPP_REFERENCE_FINGERPRINT_KEY'
      ]
    ],
    [
      'smso_submission_configuration_must_be_complete',
      [
        'SMSO_API_KEY',
        'SMSO_CALLBACK_URL',
        'SMSO_PROVIDER_REFERENCE_ENCRYPTION_KEY',
        'SMSO_PROVIDER_REFERENCE_FINGERPRINT_KEY'
      ]
    ],
    [
      'destination_configuration_must_be_complete',
      [
        'OPERATIONAL_MESSAGING_DESTINATION_ENCRYPTION_KEY',
        'OPERATIONAL_MESSAGING_DESTINATION_FINGERPRINT_KEY'
      ]
    ]
  ] as const) {
    const count = members.filter((member) => configured.has(member)).length
    if (count > 0 && count < members.length) violations.push(name)
  }
  return {
    state: missing.length === 0 && violations.length === 0 ? 'ready' : 'blocked',
    missing,
    violations
  } as const
}
