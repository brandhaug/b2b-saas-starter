import {
  account,
  notifications,
  oauthClient,
  oauthConsent,
  passkey,
  personalDataExports,
  session,
  user
} from '@b2b-saas-starter/db/schema'
import { Database, type RawD1 } from '@b2b-saas-starter/db/service'
import { EmailDelivery } from '@b2b-saas-starter/email-delivery/email-delivery'
import { Clock, DateTime, Effect, Layer } from 'effect'
import { and, eq, gt } from 'drizzle-orm'
import {
  CapabilityUnavailable,
  orUnavailable
} from '@b2b-saas-starter/failure/capability'
import {
  PersonalDataExports,
  PERSONAL_DATA_EXPORT_TTL_MS
} from './personal-data-export.ts'
import { renderPersonalDataExport } from './personal-data-export-archive.ts'
import { WorkspaceMembership } from './workspace-membership.ts'
import { AccountPreferencesService } from './account-preferences.ts'
import { NotificationPreferences } from '../notifications/notification-preferences.ts'
import { AuditEventLog } from './audit-event-log.ts'
import { auditedMutations } from './audited-mutation.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { iso } from '../internal/timestamps.ts'

const unavailable = orUnavailable('personal-data-export')

export const LivePersonalDataExports: Layer.Layer<
  PersonalDataExports,
  never,
  | Database
  | RawD1
  | WorkspaceMembership
  | AccountPreferencesService
  | NotificationPreferences
  | AuditEventLog
  | EmailDelivery
> = Layer.effect(PersonalDataExports)(
  Effect.gen(function* () {
    const db = yield* Database
    const membership = yield* WorkspaceMembership
    const prefs = yield* AccountPreferencesService
    const notices = yield* NotificationPreferences
    const delivery = yield* EmailDelivery
    const audit = yield* AuditEventLog
    const auditedMutation = yield* auditedMutations({
      prepareAuditRecord: audit.prepareRecord,
      unavailable
    })
    const collect = Effect.fn('PersonalDataExports.collect')(function* (
      userId: string
    ) {
      const [
        users,
        workspaces,
        accountPreferences,
        notificationPreferences,
        emailDeliveries,
        noticeRows,
        sessions,
        accounts,
        clients,
        consents,
        passkeys
      ] = yield* Effect.all(
        [
          unavailable(db.select().from(user).where(eq(user.id, userId)).limit(1)),
          membership.listWorkspacesForUser(userId),
          prefs.get(userId),
          notices.list(userId),
          delivery.listForUser(userId, { complete: true }),
          unavailable(
            db
              .select({
                id: notifications.id,
                workspaceId: notifications.workspaceId,
                kind: notifications.kind,
                title: notifications.title,
                message: notifications.message,
                createdAt: notifications.createdAt,
                readAt: notifications.readAt
              })
              .from(notifications)
              .where(eq(notifications.userId, userId))
          ),
          unavailable(
            db
              .select({
                id: session.id,
                expiresAt: session.expiresAt,
                createdAt: session.createdAt,
                updatedAt: session.updatedAt,
                ipAddress: session.ipAddress,
                userAgent: session.userAgent
              })
              .from(session)
              .where(eq(session.userId, userId))
          ),
          unavailable(
            db
              .select({
                id: account.id,
                providerId: account.providerId,
                issuer: account.issuer,
                accountId: account.accountId,
                createdAt: account.createdAt,
                updatedAt: account.updatedAt
              })
              .from(account)
              .where(eq(account.userId, userId))
          ),
          unavailable(
            db
              .select({
                clientId: oauthClient.clientId,
                name: oauthClient.name,
                uri: oauthClient.uri,
                icon: oauthClient.icon,
                disabled: oauthClient.disabled,
                scopes: oauthClient.scopes,
                createdAt: oauthClient.createdAt,
                updatedAt: oauthClient.updatedAt
              })
              .from(oauthClient)
              .where(eq(oauthClient.userId, userId))
          ),
          unavailable(
            db
              .select({
                id: oauthConsent.id,
                clientId: oauthConsent.clientId,
                referenceId: oauthConsent.referenceId,
                scopes: oauthConsent.scopes,
                createdAt: oauthConsent.createdAt,
                updatedAt: oauthConsent.updatedAt
              })
              .from(oauthConsent)
              .where(eq(oauthConsent.userId, userId))
          ),
          unavailable(
            db
              .select({
                id: passkey.id,
                name: passkey.name,
                credentialID: passkey.credentialID,
                deviceType: passkey.deviceType,
                backedUp: passkey.backedUp,
                transports: passkey.transports,
                createdAt: passkey.createdAt
              })
              .from(passkey)
              .where(eq(passkey.userId, userId))
          )
        ],
        { concurrency: 'unbounded' }
      )
      const found = users[0]
      if (!found) {
        return yield* new CapabilityUnavailable({
          capability: 'personal-data-export',
          reason: 'user_not_found'
        })
      }
      return {
        generatedAt: DateTime.formatIso(yield* DateTime.now),
        user: {
          id: found.id,
          name: found.name,
          email: found.email,
          image: found.image,
          username: found.username,
          displayUsername: found.displayUsername,
          emailVerified: found.emailVerified,
          locale: found.locale,
          timeZone: found.timeZone,
          createdAt: found.createdAt.toISOString(),
          updatedAt: found.updatedAt.toISOString()
        },
        workspaces,
        accountPreferences,
        notificationPreferences,
        emailDeliveries,
        notifications: noticeRows.map((r) => ({
          id: r.id,
          workspaceId: r.workspaceId,
          kind: r.kind,
          title: r.title,
          message: r.message,
          createdAt: r.createdAt,
          read: r.readAt !== null
        })),
        sessions: sessions.map((r) => ({
          id: r.id,
          ipAddress: r.ipAddress,
          userAgent: r.userAgent,
          expiresAt: r.expiresAt.toISOString(),
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString()
        })),
        linkedAccounts: accounts.map((r) => ({
          id: r.id,
          providerId: r.providerId,
          issuer: r.issuer,
          accountId: r.accountId,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString()
        })),
        oauthClients: clients.map((r) => ({
          clientId: r.clientId,
          name: r.name,
          uri: r.uri,
          icon: r.icon,
          disabled: r.disabled,
          scopes: r.scopes,
          createdAt: r.createdAt?.toISOString() ?? '',
          updatedAt: r.updatedAt?.toISOString() ?? ''
        })),
        oauthConsents: consents.map((r) => ({
          id: r.id,
          clientId: r.clientId,
          referenceId: r.referenceId,
          scopes: r.scopes,

          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString()
        })),
        passkeys: passkeys.map((r) => ({
          id: r.id,
          name: r.name,
          credentialID: r.credentialID,
          deviceType: r.deviceType,
          backedUp: r.backedUp,
          transports: r.transports,
          createdAt: r.createdAt.toISOString()
        }))
      }
    })
    /**
     * Both verbs are gated on the same thing: the caller still holds the
     * unexpired session the archive is bound to. Revoking a session has to
     * take the archive with it, so the check belongs to `download` as much as
     * to `request` — and stating it once is what keeps them from drifting.
     */
    const requireLiveSession = Effect.fn('PersonalDataExports.requireLiveSession')(
      function* (userId: string, sessionId: string, now: number) {
        const rows = yield* unavailable(
          db
            .select({ id: session.id })
            .from(session)
            .where(
              and(
                eq(session.id, sessionId),
                eq(session.userId, userId),
                gt(session.expiresAt, DateTime.toDate(DateTime.makeUnsafe(now)))
              )
            )
            .limit(1)
        )
        if (!rows[0]) {
          return yield* new CapabilityUnavailable({
            capability: 'personal-data-export',
            reason: 'session_not_found'
          })
        }
      }
    )
    const request = Effect.fn('PersonalDataExports.request')(function* (
      userId: string,
      sessionId: string
    ) {
      const data = yield* collect(userId)
      const now = yield* Clock.currentTimeMillis
      yield* requireLiveSession(userId, sessionId, now)
      const id = yield* newCapabilityId('pde')
      const expiresAt = iso(now + PERSONAL_DATA_EXPORT_TTL_MS)
      yield* auditedMutation({
        matched: Effect.succeed(true),
        auditEvent: {
          actorUserId: userId,
          actorType: 'user',
          eventType: 'auth.personal_data_exported',
          targetType: 'user',
          targetId: userId,
          metadata: { exportId: id, action: 'requested' }
        },
        write: () => [
          db.insert(personalDataExports).values({
            id,
            userId,
            sessionId,
            archive: renderPersonalDataExport(data),
            createdAt: iso(now),
            expiresAt
          })
        ]
      })
      return { id, expiresAt }
    })
    const download = Effect.fn('PersonalDataExports.download')(function* (
      userId: string,
      sessionId: string,
      exportId: string
    ) {
      const now = yield* Clock.currentTimeMillis
      yield* requireLiveSession(userId, sessionId, now)
      const rows = yield* unavailable(
        db
          .select()
          .from(personalDataExports)
          .where(
            and(
              eq(personalDataExports.id, exportId),
              eq(personalDataExports.userId, userId),
              eq(personalDataExports.sessionId, sessionId),
              gt(personalDataExports.expiresAt, iso(now))
            )
          )
          .limit(1)
      )
      const row = rows[0]
      if (!row) {
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
        metadata: { exportId, action: 'downloaded' }
      })
      return { fileName: `personal-data-${userId}.json`, json: row.archive }
    })
    return { request, download }
  })
)
