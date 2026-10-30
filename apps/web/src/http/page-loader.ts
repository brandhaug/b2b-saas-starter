import { deLocalizeUrl, getLocale, localizeUrl } from '@b2b-saas-starter/i18n/runtime'
import { DeliveryView } from '@b2b-saas-starter/capabilities/developer-platform/webhook-delivery-view'
import { Effect, Schema, type Types } from 'effect'
import { GITHUB_URL } from '../lib/github-url'
import { auditFiltersFromSearch, auditViewFromSearch } from '../lib/audit-search'
import { purchaseIntent } from '../lib/purchase-intent'
import { parseTableView } from '../lib/table-view'
import { failedDeliveryFields } from '../lib/failed-delivery-fields'
import { requireSession } from '../lib/server/auth'
import { requireAdmin } from '../lib/server/admin-route-auth'
import { readRootDataHandler } from '../lib/server/root-data.effects'
import { loadWorkspaceDirectoryHandler } from '../lib/server/workspace-directory.effects'
import {
  loadWorkspaceSuspensionHandler,
  loadWorkspaceRecoveryHandler
} from '../lib/server/workspace-suspension.effects'
import { loadWorkspaceDashboardHandler } from '../lib/server/workspace-dashboard.effects'
import { loadWorkspaceMembersHandler } from '../lib/server/workspace-members.effects'
import { loadWorkspaceSettingsHandler } from '../lib/server/workspace-settings.effects'
import {
  loadWorkspaceBillingHandler,
  loadPublicPricingHandler
} from '../lib/server/billing.effects'
import { loadWorkspaceApiTokensHandler } from '../lib/server/api-tokens.effects'
import { loadWorkspaceWebhooksHandler } from '../lib/server/webhooks.effects'
import { loadWorkspaceAuditEventsHandler } from '../lib/server/workspace-audit.effects'
import { loadAssistantPageHandler } from '../lib/server/assistant.effects'
import { loadAccountPageHandler } from '../lib/server/account.effects'
import { loadOwnedConversationsHandler } from '../lib/server/account-conversations.effects'
import { loadMcpClientConnectionsHandler } from '../lib/server/mcp-clients.effects'
import { loadNotificationPreferencesHandler } from '../lib/server/notification-preferences.effects'
import {
  loadOwnEmailDeliveryHandler,
  loadSystemEmailDeliveryHandler
} from '../lib/server/email-delivery.effects'
import {
  listSystemUsersHandler,
  loadAdminAuditEventsHandler,
  loadFailedDeliveriesHandler,
  listAdminWorkspacesHandler
} from '../lib/server/admin.effects'
import { loadOAuthConsentHandler } from '../lib/server/mcp-consent.effects'
import { invitationPreviewHandler } from '../lib/server/invitations.effects'
import { loadPurchaseHandler } from '../lib/server/purchase.effects'
import { readStrongAuthenticationStatus } from '../lib/server/strong-authentication.effects'
import { readSiteKeyHandler } from '../lib/server/turnstile.effects'
import { readSocialProviderIdsHandler } from '../lib/server/social-providers.effects'
import { readEmailVerificationStatusHandler } from '../lib/server/email-verification.effects'
import { loadDemoShowcase } from '../lib/server/demo-showcase.effects'
import { requestPresentation } from '../lib/server/i18n-context'
import { readSupportConfig } from '../lib/support-config.effects'
import { UiError, uiErrorAdapter } from '../lib/ui-error'
import { notFound, redirect } from './navigation'
import { PageData, type Page } from './page-contract'
import { publicFailure } from './errors'
import { type WorkspaceAuditInput } from '../lib/server/workspace-audit'
import { type FailedDeliveriesInput } from '../lib/server/admin'
import { webRuntime, withWebRequestScope } from '../lib/observability'

const decodeDeliveryView = Schema.decodeUnknownSync(DeliveryView)
const decodePageData = Schema.decodeUnknownSync(Schema.toType(PageData))

const failureStatus = {
  WebFailure: 400,
  WebUnauthorized: 401,
  WebForbidden: 403,
  WebNotFound: 404,
  WebUnavailable: 503
} as const

export function unlocalizedPath(url: URL): string {
  return deLocalizeUrl(url).pathname.replace(/\/$/, '') || '/'
}

async function workspacePage(
  section: string,
  workspaceSlug: string,
  search: URLSearchParams
): Promise<Page> {
  const input = { workspaceSlug }
  switch (section) {
    case '': {
      return { _tag: 'dashboard', data: await loadWorkspaceDashboardHandler(input) }
    }
    case 'members': {
      return { _tag: 'members', data: await loadWorkspaceMembersHandler(input) }
    }
    case 'settings': {
      return { _tag: 'settings', data: await loadWorkspaceSettingsHandler(input) }
    }
    case 'billing': {
      return { _tag: 'billing', data: await loadWorkspaceBillingHandler(input) }
    }
    case 'api-tokens': {
      return { _tag: 'api-tokens', data: await loadWorkspaceApiTokensHandler(input) }
    }
    case 'webhooks': {
      return { _tag: 'webhooks', data: await loadWorkspaceWebhooksHandler(input) }
    }
    case 'assistant': {
      return { _tag: 'assistant', data: await loadAssistantPageHandler(input) }
    }
    case 'suspended': {
      return { _tag: 'suspended', data: await loadWorkspaceRecoveryHandler(input) }
    }
    case 'audit': {
      const auditInput: Types.Mutable<WorkspaceAuditInput> = {
        ...input,
        filters: auditFiltersFromSearch(Object.fromEntries(search)),
        view: auditViewFromSearch(search.get('view') ?? undefined)
      }
      const cursor = search.get('cursor')
      const event = search.get('event')
      if (cursor !== null) {
        auditInput.cursor = cursor
      }
      if (event) {
        auditInput.event = event
      }
      return {
        _tag: 'audit',
        data: await loadWorkspaceAuditEventsHandler(auditInput)
      }
    }
    default: {
      // oxlint-disable-next-line effect/noThrowStatement -- navigation failures leave the Promise loader for the HTTP response mapper
      throw notFound()
    }
  }
}

async function accountPage(): Promise<Page> {
  // oxlint-disable-next-line effect/noNewPromise -- join existing Promise handlers within the same SSR request
  const [data, connections, ownedConversations] = await Promise.all([
    loadAccountPageHandler(),
    loadMcpClientConnectionsHandler(),
    loadOwnedConversationsHandler()
  ])
  return { _tag: 'account', data, connections, ownedConversations }
}

async function adminPage(search: URLSearchParams): Promise<Page> {
  const input: Types.Mutable<FailedDeliveriesInput> = {
    view: decodeDeliveryView(
      parseTableView(search.get('failureView') ?? undefined, failedDeliveryFields())
    )
  }
  const cursor = search.get('failureCursor')
  if (cursor !== null) {
    input.cursor = cursor
  }
  const [users, events, failedDeliveries, emailDeliveries, workspaces] =
    // oxlint-disable-next-line effect/noNewPromise -- join existing Promise handlers within the same SSR request
    await Promise.all([
      listSystemUsersHandler(),
      loadAdminAuditEventsHandler(),
      loadFailedDeliveriesHandler(input),
      loadSystemEmailDeliveryHandler(),
      listAdminWorkspacesHandler()
    ])
  return { _tag: 'admin', users, events, failedDeliveries, emailDeliveries, workspaces }
}

async function leafPage(path: string, url: URL): Promise<Page> {
  const search = url.searchParams
  switch (path) {
    case '/': {
      return { _tag: 'public', demo: await loadDemoShowcase() }
    }
    case '/pricing': {
      return { _tag: 'pricing', data: await loadPublicPricingHandler() }
    }
    case '/account': {
      return accountPage()
    }
    case '/help': {
      const config = readSupportConfig()
      return {
        _tag: 'help',
        email: config.email ?? null,
        helpdeskUrl: config.helpdeskUrl ?? null,
        helpCenterUrl: config.helpCenterUrl ?? null,
        appVersion: config.appVersion ?? null
      }
    }
    case '/account/notifications': {
      // oxlint-disable-next-line effect/noNewPromise -- join existing Promise handlers within the same SSR request
      const [data, deliveries] = await Promise.all([
        loadNotificationPreferencesHandler(),
        loadOwnEmailDeliveryHandler()
      ])
      return {
        _tag: 'account-notifications',
        data,
        deliveries,
        turnstileSiteKey: readSiteKeyHandler()
      }
    }
    case '/admin': {
      return adminPage(search)
    }
    case '/oauth/consent': {
      return {
        _tag: 'consent',
        data: await loadOAuthConsentHandler({ clientId: search.get('client_id') ?? '' })
      }
    }
    case '/invitations/accept': {
      return {
        _tag: 'invitation',
        data: search.has('invitation')
          ? await invitationPreviewHandler({
              invitationId: search.get('invitation') ?? ''
            })
          : { state: 'unavailable' }
      }
    }
    case '/purchase': {
      const intent = purchaseIntent(search.get('plan') ?? undefined)
      return {
        _tag: 'purchase',
        data: intent ? await loadPurchaseHandler(intent) : null,
        turnstileSiteKey: readSiteKeyHandler()
      }
    }
    case '/verify-authentication': {
      return { _tag: 'verification', data: await readStrongAuthenticationStatus() }
    }
    case '/sign-in':
    case '/sign-up':
    case '/forgot-password':
    case '/reset-password':
    case '/sign-in/email-code':
    case '/two-factor':
    case '/verify-email':
    case '/magic-link/verify': {
      return {
        _tag: 'auth',
        turnstileSiteKey: readSiteKeyHandler(),
        socialProviders: readSocialProviderIdsHandler(),
        emailVerified:
          path === '/verify-email' ? await readEmailVerificationStatusHandler() : false
      }
    }
    default: {
      return { _tag: 'public', demo: null }
    }
  }
}

/** All page authority is decided before invoking the renderer or reading child data. */
export async function loadPageData(request: Request): Promise<PageData> {
  const url = new URL(request.url)
  const path = unlocalizedPath(url)
  const returnTo = `${url.pathname}${url.search}`
  if (path === '/docs') {
    // oxlint-disable-next-line effect/noThrowStatement -- navigation redirects are HTTP Responses, never capability errors
    throw redirect({
      href: localizeUrl(new URL('/docs/getting-started/quickstart', url), {
        locale: getLocale()
      }).href
    })
  }
  if (path === '/changelog') {
    // oxlint-disable-next-line effect/noThrowStatement -- navigation redirects are HTTP Responses
    throw redirect({ href: `${GITHUB_URL}/releases` })
  }
  if (path === '/magic-link/verify' && !url.searchParams.has('error')) {
    // oxlint-disable-next-line effect/noThrowStatement -- the completed token exchange continues to the app
    throw redirect({ to: '/workspaces' })
  }
  const result: Types.Mutable<PageData> = {
    root: null,
    session: null,
    directory: null,
    suspension: null,
    page: null,
    locale: getLocale(),
    presentation: requestPresentation(),
    status: 200,
    error: null
  }
  // oxlint-disable-next-line effect/noTryCatch -- this Promise/Fetch seam maps loader failures to a sanitized render payload
  try {
    result.root = await readRootDataHandler()
    if (path === '/admin') {
      result.session = await requireAdmin(returnTo)
    } else if (
      /^\/(workspaces|account)(\/|$)/.test(path) ||
      [
        '/purchase',
        '/verify-authentication',
        '/oauth/consent',
        '/invitations/accept'
      ].includes(path)
    ) {
      result.session = await requireSession(returnTo)
    }
    if (path === '/workspaces' || path.startsWith('/workspaces/')) {
      result.directory = await loadWorkspaceDirectoryHandler()
      if (path === '/workspaces') {
        result.page = { _tag: 'directory', turnstileSiteKey: readSiteKeyHandler() }
      } else {
        const parts = path.split('/')
        const slug = decodeURIComponent(parts[2] ?? '')
        const section = parts.slice(3).join('/')
        result.suspension = await loadWorkspaceSuspensionHandler({
          workspaceSlug: slug
        })
        const recoveryPath = `/workspaces/${encodeURIComponent(slug)}/suspended`
        if (result.suspension.status === 'suspended' && section !== 'suspended') {
          // oxlint-disable-next-line effect/noThrowStatement -- subtree gate redirects before reading ordinary page data
          throw redirect({ to: recoveryPath })
        }
        if (result.suspension.status === 'active' && section === 'suspended') {
          // oxlint-disable-next-line effect/noThrowStatement -- an active workspace has no recovery page
          throw redirect({ to: `/workspaces/${encodeURIComponent(slug)}` })
        }
        if (result.suspension.strongAuthenticationRequired && section !== 'suspended') {
          // oxlint-disable-next-line effect/noThrowStatement -- privileged navigation verifies before child reads
          throw redirect({
            to: '/verify-authentication',
            search: { redirect: returnTo }
          })
        }
        result.page = await workspacePage(section, slug, url.searchParams)
      }
    } else {
      result.page = await leafPage(path, url)
    }
    return decodePageData(result)
  } catch (error) {
    if (error instanceof Response) {
      // oxlint-disable-next-line effect/noThrowStatement -- pass the navigation response to the Fetch boundary
      throw error
    }
    if (!(error instanceof UiError)) {
      await webRuntime.runPromise(
        withWebRequestScope({ event: 'web.page_failure' }, Effect.logError(error))
      )
    }
    const failure = publicFailure(error)
    result.status = failureStatus[failure._tag]
    result.error = uiErrorAdapter.toSerializable(
      new UiError(failure.code, failure.details, failure.code)
    )
    result.page = null
    return result
  }
}
