import { Effect } from 'effect'
import {
  decodeQualificationEvidence,
  evaluateQualificationRun,
  qualificationProfile
} from '@b2b-saas-starter/capabilities/notifications'

export { evaluateQualificationRun, qualificationProfile }

export const runDeterministicQualificationHarness = (
  faults: {
    readonly loseIntent?: boolean
    readonly duplicateSubmission?: boolean
    readonly duplicateCharge?: boolean
    readonly ledgerDrift?: boolean
    readonly failQueueRecovery?: boolean
    readonly breakBooking?: boolean
    readonly breakEmail?: boolean
  } = {}
) => {
  const intents = new Set<string>()
  const submitted = new Set<string>()
  const terminal = new Set<string>()
  for (let merchant = 0; merchant < qualificationProfile.merchants; merchant++)
    for (let minute = 0; minute < qualificationProfile.durationMinutes; minute++)
      for (
        let ordinal = 0;
        ordinal < qualificationProfile.submissionsPerMerchantPerMinute;
        ordinal++
      ) {
        const id = `qualification:${merchant}:${minute}:${ordinal}`
        intents.add(id)
        if (faults.loseIntent && intents.size === 1) continue
        submitted.add(id)
        terminal.add(id)
      }
  const produced = intents.size
  return {
    produced,
    submitted: submitted.size,
    terminal: terminal.size,
    firstSubmissionWithin60Seconds: submitted.size,
    platformDuplicateSubmissions: faults.duplicateSubmission ? 1 : 0,
    duplicateCharges: faults.duplicateCharge ? 1 : 0,
    ledgerVarianceMilliEuro: faults.ledgerDrift ? 1 : 0,
    queueOutageRecovered: !faults.failQueueRecovery,
    drainMinutes: faults.failQueueRecovery ? 16 : 10,
    bookingSucceeded: !faults.breakBooking,
    emailSucceeded: !faults.breakEmail
  }
}

const leakChecks = [
  ['unmasked_romanian_phone', /\+40\d{9}\b/],
  ['bearer_credential', /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i],
  [
    'assigned_secret_value',
    /\b(?:PLATFORM_API_CURSOR_SECRET|META_WHATSAPP_ACCESS_TOKEN|META_WHATSAPP_APP_SECRET|META_WHATSAPP_WEBHOOK_VERIFY_TOKEN|META_WHATSAPP_REFERENCE_ENCRYPTION_KEY|META_WHATSAPP_REFERENCE_FINGERPRINT_KEY|SMSO_API_KEY|SMSO_CALLBACK_URL|SMSO_CALLBACK_PATH_SECRET|SMSO_PROVIDER_REFERENCE_ENCRYPTION_KEY|SMSO_PROVIDER_REFERENCE_FINGERPRINT_KEY|OPERATIONAL_MESSAGING_DESTINATION_ENCRYPTION_KEY|OPERATIONAL_MESSAGING_DESTINATION_FINGERPRINT_KEY)=(?!<redacted>|<secret-store-reference>|\$\{|$)[^\s]+/
  ]
] as const

export const scanMessagingEvidence = (text: string): string[] =>
  leakChecks.filter(([, pattern]) => pattern.test(text)).map(([code]) => code)

if (import.meta.main) {
  const evidencePath = process.argv[2]
  if (evidencePath === '--simulate') {
    const result = evaluateQualificationRun(runDeterministicQualificationHarness())
    console.log(JSON.stringify(result, null, 2))
    if (result.state !== 'passed') process.exit(1)
    process.exit(0)
  }
  if (!evidencePath) {
    console.error(
      'Usage: bun scripts/operational-messaging-qualification.ts <evidence.json>'
    )
    process.exit(2)
  }
  const raw = await Bun.file(evidencePath).text()
  const leaks = scanMessagingEvidence(raw)
  const result = leaks.length
    ? { state: 'blocked', blockers: leaks }
    : evaluateQualificationRun(
        await Effect.runPromise(decodeQualificationEvidence(raw))
      )
  console.log(JSON.stringify(result, null, 2))
  if (result.state !== 'passed') process.exit(1)
}
