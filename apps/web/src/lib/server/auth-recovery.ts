import { AuditEventLog } from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { type Locale } from '@b2b-saas-starter/i18n/locale'
import { Effect } from 'effect'
import { runCapabilities } from '../capabilities'
import { sendRecoveryStartedEmail } from './auth-emails'

/** Recovery is granted only after durable audit and notification acceptance. */
export async function onRecoveryStarted(input: {
  readonly userId: string
  readonly sessionId: string
  readonly expiresAt: Date
  readonly email: string
  readonly locale?: Locale | null | undefined
}): Promise<void> {
  await runCapabilities(
    Effect.flatMap(AuditEventLog, (audit) =>
      audit.record({
        workspaceId: null,
        actorUserId: input.userId,
        actorType: 'user',
        eventType: 'auth.recovery_started',
        targetType: 'session',
        targetId: input.sessionId,
        metadata: { expiresAt: input.expiresAt.toISOString(), method: 'backup_code' }
      })
    )
  )
  await sendRecoveryStartedEmail(input)
}
