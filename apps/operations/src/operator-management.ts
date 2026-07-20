import { Effect, Schema } from 'effect'
import type { PromiseDrizzleDatabase } from '@b2b-saas-starter/db'
import {
  DeleteOperatorRequest,
  OperationsContractDenied,
  OperationsManagement,
  SetOperatorEnabledRequest,
  UpdateOperatorRolesRequest,
  makeOperationsManagementLayer,
  operatorRoleNames,
  type OperationsRateLimitDecision,
  type OperationsRateLimitRequest,
  type OperatorPrincipal,
  type OperatorRole,
  type OperatorSessionReference
} from '@b2b-saas-starter/capabilities/operations'
import { CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import { clientKey } from '@b2b-saas-starter/rate-limit'

const formText = (form: FormData, name: string): string => {
  const value = form.get(name)
  return typeof value === 'string' ? value : ''
}

type OperatorManagementRouteOptions = {
  readonly request: Request
  readonly db: PromiseDrizzleDatabase
  readonly actor: OperatorPrincipal
  readonly reference: OperatorSessionReference
  readonly securityContact: string
  readonly consumeRateLimit: (
    input: OperationsRateLimitRequest
  ) => Promise<OperationsRateLimitDecision>
  readonly redirect: (location: string) => Response
  readonly limited: (retryAfterSeconds: number) => Response
}

const acceptsJson = (request: Request): boolean =>
  request.headers.get('accept')?.includes('application/json') ?? false

const managementSuccess = (
  request: Request,
  redirect: (location: string) => Response,
  location: string
): Response => (acceptsJson(request) ? Response.json(null) : redirect(location))

const managementFailure = (error: unknown): Response => {
  if (error instanceof CapabilityUnavailable)
    return Response.json({ error: 'operator_management_unavailable' }, { status: 503 })
  if (!(error instanceof OperationsContractDenied))
    return Response.json({ error: 'operator_management_unavailable' }, { status: 503 })
  switch (error.code) {
    case 'operator-not-found':
      return Response.json({ error: 'operator_not_found' }, { status: 404 })
    case 'operator-management-stale':
    case 'last-operator-manager-protected':
    case 'operator-management-conflict':
      return Response.json({ error: 'operator_management_conflict' }, { status: 409 })
    case 'operator-management-forbidden':
    case 'operator-self-management-forbidden':
    case undefined:
      return Response.json({ error: 'operator_management_forbidden' }, { status: 403 })
  }
}

export const handleOperatorManagementRoutes = async (
  options: OperatorManagementRouteOptions
): Promise<Response | null> => {
  const url = new URL(options.request.url)
  const runManagement = <A>(
    use: (
      management: OperationsManagement['Service']
    ) => Effect.Effect<A, OperationsContractDenied | CapabilityUnavailable>
  ): Promise<A> =>
    Effect.runPromise(
      Effect.flatMap(OperationsManagement, use).pipe(
        Effect.provide(
          makeOperationsManagementLayer(options.db, {
            securityContact: options.securityContact
          })
        )
      )
    )

  const mutationRoute = url.pathname.match(
    /^\/operators\/([^/]+)\/(roles|enabled|delete)$/
  )
  if (options.request.method === 'POST' && mutationRoute) {
    const targetOperatorId = decodeURIComponent(mutationRoute[1]!)
    const action = mutationRoute[2]!
    const decision = await options.consumeRateLimit({
      category: 'operator-management',
      subjectKey: options.actor.id,
      sourceKey: clientKey(options.request),
      operation: action
    })
    if (!decision.allowed) return options.limited(decision.retryAfterSeconds!)
    const form = await options.request.formData()
    const submittedUpdatedAt = new Date(formText(form, 'expectedUpdatedAt'))
    if (Number.isNaN(submittedUpdatedAt.getTime()))
      return Response.json({ error: 'invalid_updated_at' }, { status: 400 })
    const expectedUpdatedAt = submittedUpdatedAt
    try {
      if (action === 'roles') {
        const roles = form
          .getAll('roles')
          .filter(
            (role): role is OperatorRole =>
              typeof role === 'string' &&
              operatorRoleNames.includes(role as OperatorRole)
          )
        await runManagement((management) =>
          management.updateRoles(
            Schema.decodeUnknownSync(UpdateOperatorRolesRequest)({
              actor: options.reference,
              targetOperatorId,
              expectedUpdatedAt,
              roles
            })
          )
        )
        return managementSuccess(
          options.request,
          options.redirect,
          '/operators?result=roles-updated'
        )
      }
      if (action === 'enabled') {
        await runManagement((management) =>
          management.setEnabled(
            Schema.decodeUnknownSync(SetOperatorEnabledRequest)({
              actor: options.reference,
              targetOperatorId,
              expectedUpdatedAt,
              enabled: formText(form, 'enabled') === 'true'
            })
          )
        )
        return managementSuccess(
          options.request,
          options.redirect,
          '/operators?result=enabled-state-updated'
        )
      }
      await runManagement((management) =>
        management.deleteOperator(
          Schema.decodeUnknownSync(DeleteOperatorRequest)({
            actor: options.reference,
            targetOperatorId,
            expectedUpdatedAt
          })
        )
      )
      return managementSuccess(
        options.request,
        options.redirect,
        '/operators?result=operator-deleted'
      )
    } catch (error) {
      return managementFailure(error)
    }
  }

  if (options.request.method !== 'GET' || url.pathname !== '/api/operations/operators')
    return null
  try {
    const operators = await runManagement((management) =>
      management.list(options.reference)
    )
    return Response.json({ actorOperatorId: options.actor.id, operators })
  } catch {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
}
