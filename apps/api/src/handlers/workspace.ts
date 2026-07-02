import { Effect, Result, type Scope } from 'effect'
import { EmailDispatcher, WorkspaceInvitationEmail } from '@b2b-saas-starter/email'
import {
  ApiTokenRegistry,
  AuditEventLog,
  CreateApiTokenPayload,
  CreateWebhookEndpointPayload,
  ImplementationReports,
  IntegrationSurfaces,
  NotificationFeed,
  StarterModuleCatalog,
  WebhookEndpoints,
  WebhookPublisher,
  WorkspaceContext,
  workspaceOverview,
  WorkspaceMembership,
  type CapabilityServices,
  type CapabilityUnavailable
} from '@b2b-saas-starter/capabilities'
import { SendInvitationPayload } from '@b2b-saas-starter/api'
import { annotateWide } from '@b2b-saas-starter/logger'
import { decodeBodyOr400, json, type InvalidInput } from '../http.ts'

export type WorkspaceServices = CapabilityServices | WorkspaceContext

/**
 * GET-able workspace resources. The route table derives its path alternation
 * from these keys, so adding an entry here is the whole wiring.
 */
export const workspaceResources = {
  // Shared projection — the web dashboard renders the same composition
  // (`workspaceDashboard`), keeping REST and app views aligned.
  overview: workspaceOverview,
  modules: Effect.gen(function* () {
    const catalog = yield* StarterModuleCatalog
    return yield* catalog.listModules
  }),
  members: Effect.gen(function* () {
    const membership = yield* WorkspaceMembership
    return yield* membership.listMembers
  }),
  notifications: Effect.gen(function* () {
    const feed = yield* NotificationFeed
    return yield* feed.list
  }),
  'api-tokens': Effect.gen(function* () {
    const tokens = yield* ApiTokenRegistry
    return yield* tokens.list
  }),
  webhooks: Effect.gen(function* () {
    const webhooks = yield* WebhookEndpoints
    return yield* webhooks.list
  }),
  integrations: Effect.gen(function* () {
    const integrations = yield* IntegrationSurfaces
    return yield* integrations.list
  }),
  reports: Effect.gen(function* () {
    const reports = yield* ImplementationReports
    return yield* reports.list
  }),
  'audit-events': Effect.gen(function* () {
    const log = yield* AuditEventLog
    return yield* log.list
  })
} as const satisfies Record<
  string,
  Effect.Effect<unknown, CapabilityUnavailable, WorkspaceServices>
>

export type WorkspaceResource = keyof typeof workspaceResources

/**
 * Best-effort fan-out to subscribed webhook endpoints after a mutation has
 * already committed. A queue outage must not fail the response — it is
 * surfaced on the wide event instead.
 */
export const publishWebhookEvent = (
  eventType: string,
  payload: unknown
): Effect.Effect<void, never, WebhookPublisher | WorkspaceContext | Scope.Scope> =>
  Effect.gen(function* () {
    const publisher = yield* WebhookPublisher
    const published = yield* Effect.result(publisher.publish({ eventType, payload }))
    if (Result.isFailure(published)) {
      yield* annotateWide({
        webhookPublish: 'failed',
        webhookPublishReason: published.failure.reason
      })
    }
  })

export const createTokenEffect = (
  request: Request
): Effect.Effect<
  Response,
  CapabilityUnavailable | InvalidInput,
  ApiTokenRegistry | WebhookPublisher | WorkspaceContext | Scope.Scope
> =>
  Effect.gen(function* () {
    const payload = yield* decodeBodyOr400(
      request,
      CreateApiTokenPayload,
      'invalid_api_token_input'
    )
    const tokens = yield* ApiTokenRegistry
    const created = yield* tokens.create({
      name: payload.name,
      scopes: payload.scopes
    })
    // Never include the plaintext token in the webhook payload.
    yield* publishWebhookEvent('api_token.created', {
      id: created.id,
      name: created.name,
      prefix: created.prefix,
      scopes: created.scopes,
      createdAt: created.createdAt
    })
    yield* annotateWide({
      outcome: 'created',
      tokenId: created.id,
      tokenScopes: created.scopes
    })
    return json(created, { status: 201 })
  })

export const revokeTokenEffect = (
  tokenId: string
): Effect.Effect<
  Response,
  CapabilityUnavailable,
  ApiTokenRegistry | WebhookPublisher | WorkspaceContext | Scope.Scope
> =>
  Effect.gen(function* () {
    const tokens = yield* ApiTokenRegistry
    const revoked = yield* tokens.revoke({ tokenId })
    // Cross-workspace or double revokes are no-ops — don't announce them.
    if (revoked) {
      yield* publishWebhookEvent('api_token.revoked', { tokenId })
    }
    yield* annotateWide({ outcome: 'revoked' })
    return json({ status: 'revoked' })
  })

export const createWebhookEffect = (
  request: Request
): Effect.Effect<
  Response,
  CapabilityUnavailable | InvalidInput,
  WebhookEndpoints | WebhookPublisher | WorkspaceContext | Scope.Scope
> =>
  Effect.gen(function* () {
    const payload = yield* decodeBodyOr400(
      request,
      CreateWebhookEndpointPayload,
      'invalid_webhook_input'
    )
    const webhooks = yield* WebhookEndpoints
    const created = yield* Effect.result(
      webhooks.create({
        url: payload.url,
        events: payload.events,
        ...(payload.description !== undefined
          ? { description: payload.description }
          : {})
      })
    )
    if (Result.isFailure(created)) {
      // SSRF/shape guard rejection is caller error (400); D1 outage stays on
      // the error channel and maps to 503 at the route seam.
      if (created.failure._tag === 'InvalidWebhookUrl') {
        yield* annotateWide({
          outcome: 'invalid_webhook_url',
          webhookUrlReason: created.failure.reason
        })
        return json(
          { error: 'invalid_webhook_url', reason: created.failure.reason },
          { status: 400 }
        )
      }
      return yield* Effect.fail(created.failure)
    }
    yield* publishWebhookEvent('webhook_endpoint.created', created.success)
    yield* annotateWide({ outcome: 'created', webhookEndpointId: created.success.id })
    return json(created.success, { status: 201 })
  })

export const invitationEffect = (
  request: Request,
  fromAddress: string | undefined
): Effect.Effect<
  Response,
  InvalidInput,
  WorkspaceContext | EmailDispatcher | WebhookPublisher | Scope.Scope
> =>
  Effect.gen(function* () {
    const payload = yield* decodeBodyOr400(
      request,
      SendInvitationPayload,
      'invalid_invitation_input'
    )
    const ctx = yield* WorkspaceContext
    yield* annotateWide({
      workspaceId: ctx.workspace.id,
      workspaceName: ctx.workspace.name
    })
    const inviteUrl = `${new URL(request.url).origin}/invitations/accept?workspace=${ctx.workspace.slug}`
    const dispatcher = yield* EmailDispatcher
    const delivery = yield* Effect.result(
      dispatcher.send({
        from: fromAddress ?? 'noreply@example.com',
        to: payload.to,
        subject: `You are invited to ${ctx.workspace.name}`,
        element: WorkspaceInvitationEmail({
          workspaceName: ctx.workspace.name,
          inviteUrl
        })
      })
    )
    if (Result.isFailure(delivery)) {
      yield* annotateWide({
        outcome: 'invitation_send_failed',
        emailError: delivery.failure.message
      })
      return json({ error: 'invitation_send_failed' }, { status: 502 })
    }
    yield* publishWebhookEvent('workspace_invitation.sent', {
      workspaceSlug: ctx.workspace.slug,
      to: payload.to
    })
    yield* annotateWide({ outcome: 'queued' })
    return json({ status: 'queued', delivery: delivery.success }, { status: 202 })
  })
