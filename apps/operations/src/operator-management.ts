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
  type ManagedOperator,
  type OperationsRateLimitDecision,
  type OperationsRateLimitRequest,
  type OperatorPrincipal,
  type OperatorRole,
  type OperatorSessionReference
} from '@b2b-saas-starter/capabilities/operations'
import { CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import { clientKey } from '@b2b-saas-starter/rate-limit'

const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[character]!
  )

const formText = (form: FormData, name: string): string => {
  const value = form.get(name)
  return typeof value === 'string' ? value : ''
}

const operatorRoleLabels: Record<OperatorRole, string> = {
  'merchant-reader': 'Merchant Reader',
  'merchant-impersonator': 'Merchant Impersonator',
  'impersonation-auditor': 'Impersonation Auditor',
  'operator-manager': 'Operator Manager'
}

const operatorRowHtml = (
  operator: ManagedOperator,
  actorOperatorId: string
): string => {
  const isSelf = operator.id === actorOperatorId
  const roles = operatorRoleNames
    .map(
      (role) =>
        `<label><input type="checkbox" name="roles" value="${role}"${operator.roles.includes(role) ? ' checked' : ''}${isSelf ? ' disabled' : ''}>${operatorRoleLabels[role]}</label>`
    )
    .join('')
  const sessionState = operator.activeSession.active
    ? `Active until ${escapeHtml(operator.activeSession.absoluteExpiresAt?.toISOString() ?? '')}`
    : 'No active session'
  const controls = isSelf
    ? '<p>Manage your own account through another Operator Manager.</p>'
    : `<form method="post" action="/operators/${encodeURIComponent(operator.id)}/roles"><input type="hidden" name="expectedUpdatedAt" value="${operator.updatedAt.toISOString()}">${roles}<button type="submit">Save roles</button></form><form method="post" action="/operators/${encodeURIComponent(operator.id)}/enabled"><input type="hidden" name="expectedUpdatedAt" value="${operator.updatedAt.toISOString()}"><input type="hidden" name="enabled" value="${operator.enabled ? 'false' : 'true'}"><button type="submit">${operator.enabled ? 'Disable' : 'Enable'}</button></form><details><summary>Delete operator</summary><p>This permanently removes the operator identity and its sessions.</p><form method="post" action="/operators/${encodeURIComponent(operator.id)}/delete"><input type="hidden" name="expectedUpdatedAt" value="${operator.updatedAt.toISOString()}"><button style="background:#b91c1c;color:#fff" type="submit">Confirm delete</button></form></details>`
  return `<tr><th scope="row">${escapeHtml(operator.name)}<br><code>${escapeHtml(operator.email)}</code></th><td>${operator.enabled ? 'Enabled' : 'Disabled'}</td><td>${operator.enrollmentState === 'complete' ? 'Complete' : 'Incomplete'}</td><td>${operator.roles.map((role) => escapeHtml(operatorRoleLabels[role])).join(', ')}</td><td>${sessionState}<br>Last sign-in: ${escapeHtml(operator.lastSignInAt?.toISOString() ?? 'Never')}</td><td>Created ${escapeHtml(operator.createdAt.toISOString())}<br>Updated ${escapeHtml(operator.updatedAt.toISOString())}</td><td>${controls}</td></tr>`
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
  readonly renderHtml: (title: string, body: string) => Response
  readonly redirect: (location: string) => Response
  readonly limited: (retryAfterSeconds: number) => Response
  readonly listActionsHtml?: string
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
    const expectedUpdatedAt = Number.isNaN(submittedUpdatedAt.getTime())
      ? new Date(0)
      : submittedUpdatedAt
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
        return options.redirect('/operators?result=roles-updated')
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
        return options.redirect('/operators?result=enabled-state-updated')
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
      return options.redirect('/operators?result=operator-deleted')
    } catch (error) {
      const reason =
        error instanceof OperationsContractDenied
          ? error.reason
          : 'operator management unavailable'
      return options.redirect(`/operators?error=${encodeURIComponent(reason)}`)
    }
  }

  const isJsonRequest = url.pathname === '/api/operations/operators'
  if (
    options.request.method !== 'GET' ||
    (url.pathname !== '/operators' && !isJsonRequest)
  )
    return null
  try {
    const operators = await runManagement((management) =>
      management.list(options.reference)
    )
    if (isJsonRequest)
      return Response.json({ actorOperatorId: options.actor.id, operators })
    const result = url.searchParams.get('result')
    const notice =
      result === 'roles-updated'
        ? '<p role="status">Operator roles updated</p>'
        : result === 'enabled-state-updated'
          ? '<p role="status">Operator enabled state updated</p>'
          : result === 'operator-deleted'
            ? '<p role="status">Operator deleted</p>'
            : url.searchParams.has('error')
              ? `<p role="alert">${escapeHtml(url.searchParams.get('error') ?? '')}</p>`
              : ''
    return options.renderHtml(
      'System Operators',
      `<p><a href="/">Back to Operations</a></p><h1>System Operators</h1>${options.listActionsHtml ?? ''}${notice}<table><thead><tr><th>Operator</th><th>Enabled state</th><th>Enrollment</th><th>Roles</th><th>Operator Session</th><th>Timestamps</th><th>Management</th></tr></thead><tbody>${operators.map((operator) => operatorRowHtml(operator, options.actor.id)).join('')}</tbody></table>`
    )
  } catch {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
}
