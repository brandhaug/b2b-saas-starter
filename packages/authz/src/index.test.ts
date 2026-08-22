import { Effect } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import { requirePermission } from './guard.ts'
import {
  authorize,
  memberPrincipal,
  tokenPrincipal,
  type PermissionRequest,
  type Principal
} from './principal.ts'
import { starterStatements } from './statements.ts'

type Permission = { readonly label: string; readonly request: PermissionRequest }

/**
 * One entry per (resource, action) pair in `starterStatements`. Written out
 * rather than derived so each request keeps its literal type — and so the
 * exhaustiveness test below can prove the two agree.
 */
const PERMISSIONS = [
  { label: 'organization:update', request: { organization: ['update'] } },
  { label: 'organization:delete', request: { organization: ['delete'] } },
  { label: 'member:create', request: { member: ['create'] } },
  { label: 'member:update', request: { member: ['update'] } },
  { label: 'member:delete', request: { member: ['delete'] } },
  { label: 'invitation:create', request: { invitation: ['create'] } },
  { label: 'invitation:cancel', request: { invitation: ['cancel'] } },
  { label: 'team:create', request: { team: ['create'] } },
  { label: 'team:update', request: { team: ['update'] } },
  { label: 'team:delete', request: { team: ['delete'] } },
  { label: 'ac:create', request: { ac: ['create'] } },
  { label: 'ac:read', request: { ac: ['read'] } },
  { label: 'ac:update', request: { ac: ['update'] } },
  { label: 'ac:delete', request: { ac: ['delete'] } },
  { label: 'apiToken:list', request: { apiToken: ['list'] } },
  { label: 'apiToken:create', request: { apiToken: ['create'] } },
  { label: 'apiToken:revoke', request: { apiToken: ['revoke'] } },
  { label: 'webhook:list', request: { webhook: ['list'] } },
  { label: 'webhook:create', request: { webhook: ['create'] } },
  { label: 'webhook:disable', request: { webhook: ['disable'] } },
  { label: 'webhook:rotateSecret', request: { webhook: ['rotateSecret'] } },
  { label: 'auditLog:read', request: { auditLog: ['read'] } },
  { label: 'notification:read', request: { notification: ['read'] } },
  { label: 'assistant:read', request: { assistant: ['read'] } },
  { label: 'mcp:read', request: { mcp: ['read'] } }
] satisfies readonly Permission[]

const EVERY_LABEL = PERMISSIONS.map((permission) => permission.label)

/** Read access to the workspace's own content — the floor of every grant set. */
const READ_ONLY = [
  'ac:read',
  'apiToken:list',
  'webhook:list',
  'auditLog:read',
  'notification:read',
  'assistant:read',
  'mcp:read'
]

const GRANTS: readonly {
  readonly name: string
  readonly principal: Principal
  readonly granted: readonly string[]
}[] = [
  { name: 'owner role', principal: memberPrincipal('owner'), granted: EVERY_LABEL },
  {
    name: 'admin role',
    principal: memberPrincipal('admin'),
    // Everything the owner has except deleting the workspace.
    granted: EVERY_LABEL.filter((label) => label !== 'organization:delete')
  },
  {
    name: 'member role',
    principal: memberPrincipal('member'),
    granted: ['ac:read', 'notification:read', 'assistant:read', 'mcp:read']
  },
  { name: 'read scope', principal: tokenPrincipal(['read']), granted: READ_ONLY },
  {
    name: 'write scope',
    principal: tokenPrincipal(['write']),
    granted: [...READ_ONLY, 'invitation:create', 'webhook:create']
  },
  { name: 'admin scope', principal: tokenPrincipal(['admin']), granted: EVERY_LABEL }
]

describe('statements', () => {
  it('retains the organization plugin defaults', () => {
    // Dropping one breaks the plugin's own member and invitation endpoints,
    // not merely a starter permission.
    expect(starterStatements.organization).toEqual(['update', 'delete'])
    expect(starterStatements.member).toEqual(['create', 'update', 'delete'])
    expect(starterStatements.invitation).toEqual(['create', 'cancel'])
    expect(starterStatements.team).toEqual(['create', 'update', 'delete'])
    expect(starterStatements.ac).toEqual(['create', 'read', 'update', 'delete'])
  })

  it('covers every declared statement in the matrix below', () => {
    const declared = Object.entries(starterStatements).flatMap(([resource, actions]) =>
      actions.map((action) => `${resource}:${action}`)
    )
    expect(new Set(declared)).toEqual(new Set(EVERY_LABEL))
  })
})

describe.each(GRANTS)('$name', (grant) => {
  it.each(PERMISSIONS)('$label', (permission) => {
    expect(authorize(grant.principal, permission.request).success).toBe(
      grant.granted.includes(permission.label)
    )
  })
})

describe('member denials', () => {
  it('cannot read the audit log or list API tokens', () => {
    // Both leak the workspace's security posture, so the denial is deliberate
    // rather than an oversight of the default role.
    const member = memberPrincipal('member')
    expect(authorize(member, { auditLog: ['read'] }).success).toBe(false)
    expect(authorize(member, { apiToken: ['list'] }).success).toBe(false)
  })
})

describe('token scopes', () => {
  it('grants a permission covered by any one of the held scopes', () => {
    const token = tokenPrincipal(['read', 'write'])
    expect(authorize(token, { webhook: ['create'] }).success).toBe(true)
    expect(authorize(token, { auditLog: ['read'] }).success).toBe(true)
  })

  it('cannot mint a token from the write scope', () => {
    // Minting is how a token would escalate itself: a `write` token allowed to
    // create tokens could issue an `admin` one. Only owner-level principals
    // mint, so a token holding `write` may list tokens and nothing more.
    expect(authorize(tokenPrincipal(['write']), { apiToken: ['create'] }).success).toBe(
      false
    )
    expect(authorize(tokenPrincipal(['write']), { apiToken: ['list'] }).success).toBe(
      true
    )
    expect(authorize(tokenPrincipal(['admin']), { apiToken: ['create'] }).success).toBe(
      true
    )
  })

  it('denies a token holding no scopes', () => {
    expect(authorize(tokenPrincipal([]), { auditLog: ['read'] }).success).toBe(false)
  })

  it('denies a request whose actions are not all covered', () => {
    // The default connector is AND: a partial match is not a match.
    const token = tokenPrincipal(['read'])
    expect(authorize(token, { apiToken: ['list', 'create'] }).success).toBe(false)
  })
})

describe('requirePermission', () => {
  it.effect('passes when the principal covers the request', () =>
    Effect.scoped(requirePermission(memberPrincipal('admin'), { apiToken: ['create'] }))
  )

  it.effect('fails with AuthorizationDenied when the principal does not', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.scoped(
          requirePermission(memberPrincipal('member'), { auditLog: ['read'] })
        )
      )
      expect(error._tag).toBe('AuthorizationDenied')
      expect(error.reason).toBe('insufficient_permission')
    })
  )

  it.effect('denies an unresolved principal instead of passing it through', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        Effect.scoped(requirePermission(null, { auditLog: ['read'] }))
      )
      expect(error.reason).toBe('no_principal')
    })
  )
})
