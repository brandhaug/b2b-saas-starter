import { Effect, Option, Schema } from 'effect'

import { WorkspaceInvitations } from '@b2b-saas-starter/capabilities/governance/workspace-invitations'
import { WorkspaceMembership } from '@b2b-saas-starter/capabilities/governance/workspace-membership'
import { WorkspaceSuspensionService } from '@b2b-saas-starter/capabilities/governance/workspace-suspension'
import { runCapabilities } from '@/lib/capabilities'
import { type AuthExchange } from './auth-audit/exchanges'

export type SessionIdentity = {
  readonly user: { readonly id: string; readonly email: string }
  readonly session: { readonly activeOrganizationId?: string | null | undefined }
}

const SAFE_ORGANIZATION_ACTIONS = new Set([
  '/organization/create',
  '/organization/list',
  '/organization/set-active',
  '/organization/list-user-invitations'
])

export function isOrganizationProductAction(exchange: AuthExchange) {
  if (!exchange.pathname.includes('/organization/')) {
    return false
  }
  const action = exchange.pathname.slice(exchange.pathname.indexOf('/organization/'))
  return !SAFE_ORGANIZATION_ACTIONS.has(action)
}

const EncodedRequestTarget = Schema.Struct({
  organizationId: Schema.optionalKey(Schema.Unknown),
  organizationSlug: Schema.optionalKey(Schema.Unknown),
  slug: Schema.optionalKey(Schema.Unknown),
  invitationId: Schema.optionalKey(Schema.Unknown)
})
const decodeEncodedRequestTarget = Schema.decodeUnknownOption(EncodedRequestTarget)
const decodeString = Schema.decodeUnknownOption(Schema.String)

type RequestTarget = {
  readonly organizationId?: string
  readonly organizationSlug?: string
  readonly slug?: string
  readonly invitationId?: string
}

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- this function is the request I/O parser; the schemas below establish the domain shape field by field
function decodeRequestTarget(input: unknown): RequestTarget {
  return Option.match(decodeEncodedRequestTarget(input), {
    onNone: () => ({}),
    onSome: (encoded) => ({
      ...Option.match(decodeString(encoded.organizationId), {
        onNone: () => ({}),
        onSome: (organizationId) => ({ organizationId })
      }),
      ...Option.match(decodeString(encoded.organizationSlug), {
        onNone: () => ({}),
        onSome: (organizationSlug) => ({ organizationSlug })
      }),
      ...Option.match(decodeString(encoded.slug), {
        onNone: () => ({}),
        onSome: (slug) => ({ slug })
      }),
      ...Option.match(decodeString(encoded.invitationId), {
        onNone: () => ({}),
        onSome: (invitationId) => ({ invitationId })
      })
    })
  })
}

type WorkspaceRef = { readonly id: string; readonly slug: string }

export type OrganizationSuspensionDependencies = {
  readonly listWorkspaces: (userId: string) => Promise<ReadonlyArray<WorkspaceRef>>
  readonly invitationDetail: (
    invitationId: string
  ) => Promise<{ readonly workspaceId: string; readonly email: string } | undefined>
  readonly isProductAllowed: (workspaceId: string) => Promise<boolean>
}

async function requestTarget(request: Request): Promise<RequestTarget> {
  const url = new URL(request.url)
  const query = decodeRequestTarget(Object.fromEntries(url.searchParams))
  if (request.method === 'GET') {
    return query
  }
  const body: unknown = await request
    .clone()
    .json()
    .catch(() => ({}))
  const decodedBody = decodeRequestTarget(body)
  return { ...query, ...decodedBody }
}

function jsonError(status: number, code: string) {
  return new Response(JSON.stringify({ code }), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  })
}

/** Enforces suspension before Better Auth can observe or mutate workspace state. */
export async function enforceOrganizationSuspension(
  request: Request,
  exchange: AuthExchange,
  session: SessionIdentity | undefined,
  dependencies: OrganizationSuspensionDependencies
): Promise<Response | null> {
  if (!isOrganizationProductAction(exchange) || session === undefined) {
    return null
  }

  const target = await requestTarget(request)
  let workspaceId: string | undefined
  if (target.invitationId) {
    const invitation = await dependencies.invitationDetail(target.invitationId)
    const memberships = await dependencies.listWorkspaces(session.user.id)
    if (
      !invitation ||
      (invitation.email.toLowerCase() !== session.user.email.toLowerCase() &&
        !memberships.some((workspace) => workspace.id === invitation.workspaceId))
    ) {
      return jsonError(404, 'not_found')
    }
    workspaceId = invitation.workspaceId
  } else {
    const requestedId = target.organizationId
    const requestedSlug = target.organizationSlug
    const memberships = await dependencies.listWorkspaces(session.user.id)
    let workspace: WorkspaceRef | undefined
    if (requestedId) {
      workspace = memberships.find((candidate) => candidate.id === requestedId)
    } else if (requestedSlug) {
      workspace = memberships.find((candidate) => candidate.slug === requestedSlug)
    } else {
      workspace = memberships.find(
        (candidate) => candidate.id === session.session.activeOrganizationId
      )
    }
    if (
      (requestedId || requestedSlug || session.session.activeOrganizationId) &&
      !workspace
    ) {
      return jsonError(404, 'not_found')
    }
    workspaceId = workspace?.id
  }

  if (!workspaceId) {
    return jsonError(404, 'not_found')
  }
  if (!(await dependencies.isProductAllowed(workspaceId))) {
    return jsonError(403, 'workspace_suspended')
  }
  return null
}

export async function suspendedOrganizationResponse(
  request: Request,
  exchange: AuthExchange,
  session: SessionIdentity | undefined
): Promise<Response | null> {
  return enforceOrganizationSuspension(request, exchange, session, {
    listWorkspaces: (userId) =>
      runCapabilities(
        Effect.map(
          Effect.flatMap(WorkspaceMembership, (service) =>
            service.listWorkspacesForUser(userId)
          ),
          (memberships) => memberships.map(({ workspace }) => workspace)
        )
      ),
    invitationDetail: (invitationId) =>
      runCapabilities(
        Effect.map(
          Effect.flatMap(WorkspaceInvitations, (service) => service.find(invitationId)),
          Option.match({
            onNone: () => undefined,
            onSome: ({ workspaceId, email }) => ({ workspaceId, email })
          })
        )
      ),
    isProductAllowed: (workspaceId) =>
      runCapabilities(
        Effect.flatMap(WorkspaceSuspensionService, (service) =>
          service.requireAllowed(workspaceId, 'product')
        ).pipe(
          Effect.as(true),
          Effect.catchTag('WorkspaceSuspended', () => Effect.succeed(false))
        )
      )
  })
}
