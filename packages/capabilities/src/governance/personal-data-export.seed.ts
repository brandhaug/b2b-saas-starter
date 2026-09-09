import { Clock, DateTime, Effect, Layer } from 'effect'
import { EmailDelivery } from '@b2b-saas-starter/email-delivery/email-delivery'
import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import {
  PersonalDataExports,
  PERSONAL_DATA_EXPORT_TTL_MS
} from './personal-data-export.ts'
import {
  type PersonalDataExport,
  renderPersonalDataExport
} from './personal-data-export-archive.ts'
import { WorkspaceMembership } from './workspace-membership.ts'
import { AccountPreferencesService } from './account-preferences.ts'
import { NotificationPreferences } from '../notifications/notification-preferences.ts'
import {
  type Notification,
  type SeedNotification
} from '../notifications/notification-feed.ts'
import { AuditEventLog } from './audit-event-log.ts'
import { newCapabilityId } from '../internal/ids.ts'

function iso(time: number): string {
  return DateTime.formatIso(DateTime.makeUnsafe(time))
}

export function SeedPersonalDataExports(
  profiles: ReadonlyArray<PersonalDataExport['user']>,
  seedNotifications: ReadonlyArray<SeedNotification>,
  seedWorkspaceId: string
): Layer.Layer<
  PersonalDataExports,
  never,
  | WorkspaceMembership
  | AccountPreferencesService
  | NotificationPreferences
  | AuditEventLog
  | EmailDelivery
> {
  const rows = new Map<
    string,
    { userId: string; sessionId: string; expiresAt: number; json: string }
  >()
  return Layer.effect(PersonalDataExports)(
    Effect.gen(function* () {
      const membership = yield* WorkspaceMembership
      const prefs = yield* AccountPreferencesService
      const notices = yield* NotificationPreferences
      const delivery = yield* EmailDelivery
      const audit = yield* AuditEventLog
      function collect(userId: string) {
        return Effect.gen(function* () {
          const profile = profiles.find((candidate) => candidate.id === userId)
          if (profile === undefined) {
            return yield* new CapabilityUnavailable({
              capability: 'personal-data-export',
              reason: 'user_not_found'
            })
          }
          const workspaces = yield* membership.listWorkspacesForUser(userId)
          const accountPreferences = yield* prefs.get(userId)
          const notificationPreferences = yield* notices.list(userId)
          return {
            generatedAt: DateTime.formatIso(yield* DateTime.now),
            user: {
              ...profile,
              locale: accountPreferences.locale,
              timeZone: accountPreferences.timeZone
            },
            workspaces,
            accountPreferences,
            notificationPreferences,
            emailDeliveries: yield* delivery.exportForUser(userId),
            notifications: seedNotifications.reduce<
              Array<Notification & { workspaceId: string | null }>
            >((items, row) => {
              if (row.userId === userId) {
                items.push({
                  id: row.id,
                  kind: row.kind,
                  title: row.title,
                  message: row.message,
                  createdAt: row.createdAt,
                  read: row.read,
                  workspaceId: seedWorkspaceId
                })
              }
              return items
            }, []),
            sessions: [],
            linkedAccounts: [],
            oauthClients: [],
            oauthConsents: [],
            passkeys: []
          }
        })
      }
      return {
        request: (userId, sessionId) =>
          Effect.gen(function* () {
            const data = yield* collect(userId)
            const now = yield* Clock.currentTimeMillis
            const id = yield* newCapabilityId('pde')
            for (const [existingId, existing] of rows) {
              if (existing.expiresAt <= now) {
                rows.delete(existingId)
              }
            }
            rows.set(id, {
              userId,
              sessionId,
              expiresAt: now + PERSONAL_DATA_EXPORT_TTL_MS,
              json: renderPersonalDataExport(data)
            })
            yield* audit.record({
              actorUserId: userId,
              actorType: 'user',
              eventType: 'auth.personal_data_exported',
              targetType: 'user',
              targetId: userId,
              metadata: { exportId: id, action: 'requested' }
            })
            return { id, expiresAt: iso(now + PERSONAL_DATA_EXPORT_TTL_MS) }
          }),
        download: (userId, sessionId, id) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis
            const row = rows.get(id)
            if (
              !row ||
              row.userId !== userId ||
              row.sessionId !== sessionId ||
              row.expiresAt <= now
            ) {
              return yield* new CapabilityUnavailable({
                capability: 'personal-data-export',
                reason: 'export_not_found'
              })
            }
            yield* audit.record({
              actorUserId: userId,
              actorType: 'user',
              eventType: 'auth.personal_data_exported',
              targetType: 'user',
              targetId: userId,
              metadata: { exportId: id, action: 'downloaded' }
            })
            return { fileName: `personal-data-${userId}.json`, json: row.json }
          })
      }
    })
  )
}
