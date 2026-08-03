import type { Database } from '@b2b-saas-starter/db/client'
import {
  beginOperatorTwoFactorEnrollment,
  hashOperatorEnrollmentPassword,
  readOperatorSessionReference,
  verifyOperatorTwoFactorEnrollment,
  type OperationsAuth
} from '@b2b-saas-starter/auth/operations'
import {
  OperatorInvitationDenied,
  OperatorInvitations,
  makeOperatorInvitationsLayer,
  operatorRoleNames,
  type OperatorRole
} from '@b2b-saas-starter/capabilities/operations'
import { Effect } from 'effect'
import type { OperationsConfig } from './operations-config.ts'
import type { OperatorInvitationDelivery } from './operations-email.ts'
import { redirect } from './http-response.ts'

const enrollmentCookieName = 'operations.enrollment'
const operatorRoleNameSet = new Set(operatorRoleNames)

const text = (form: FormData, name: string): string => {
  const value = form.get(name)
  return typeof value === 'string' ? value : ''
}

const randomCredential = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

const hashCredential = async (credential: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(credential)
  )
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

const cookieValue = (request: Request): string | null => {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=')
    if (name === enrollmentCookieName) return value.join('=') || null
  }
  return null
}

const enrollmentCookie = (
  credential: string,
  config: OperationsConfig,
  maxAge = 30 * 60
): string =>
  `${enrollmentCookieName}=${credential}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.production ? '; Secure' : ''}`

const runInvitations = <A>(
  db: Database,
  use: (
    invitations: OperatorInvitations['Service']
  ) => Effect.Effect<A, OperatorInvitationDenied>
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const invitations = yield* OperatorInvitations
      return yield* use(invitations)
    }).pipe(Effect.provide(makeOperatorInvitationsLayer(db)))
  )

const invitationRoles = (form: FormData): readonly OperatorRole[] =>
  form
    .getAll('roles')
    .filter(
      (role): role is OperatorRole =>
        typeof role === 'string' && operatorRoleNameSet.has(role as OperatorRole)
    )

const enrollmentError = (message: string, status = 400): Response =>
  Response.json(
    { error: 'operator_enrollment_unavailable', reason: message },
    { status }
  )

export const resumeOperatorEnrollment = async (input: {
  readonly operatorId: string
  readonly db: Database
  readonly config: OperationsConfig
}): Promise<Response> => {
  const credential = randomCredential()
  const tokenHash = await hashCredential(credential)
  await runInvitations(input.db, (invitations) =>
    invitations.resume({ operatorId: input.operatorId, enrollmentTokenHash: tokenHash })
  )
  return redirect('/enroll/security', [enrollmentCookie(credential, input.config)])
}

export const handleOperatorEnrollmentRoutes = async (input: {
  readonly request: Request
  readonly config: OperationsConfig
  readonly db: Database
  readonly auth: OperationsAuth
  readonly invitationDelivery: OperatorInvitationDelivery
}): Promise<Response | null> => {
  const { request, config, db, auth, invitationDelivery } = input
  const url = new URL(request.url)

  if (request.method === 'POST' && url.pathname === '/operators/invitations') {
    const reference = await readOperatorSessionReference({
      auth,
      headers: request.headers
    })
    if (!reference) return redirect('/sign-in')
    const form = await request.formData()
    const credential = randomCredential()
    const tokenHash = await hashCredential(credential)
    try {
      if (!invitationDelivery.configured) {
        return enrollmentError('Operator invitation email is not configured.', 503)
      }
      const invitation = await runInvitations(db, (invitations) =>
        invitations.invite({
          actor: reference,
          email: text(form, 'email'),
          roles: invitationRoles(form),
          tokenHash
        })
      )
      const invitationURL = `${config.baseURL}/enroll?token=${encodeURIComponent(credential)}`
      try {
        await invitationDelivery.send({ email: invitation.email, url: invitationURL })
      } catch {
        await runInvitations(db, (invitations) =>
          invitations.revoke({ actor: reference, invitationId: invitation.id })
        )
        throw new Error('operator invitation email could not be delivered')
      }
      return Response.json({
        invitation: {
          id: invitation.id,
          email: invitation.email,
          expiresAt: invitation.expiresAt.toISOString()
        }
      })
    } catch (error) {
      return enrollmentError(
        error instanceof Error ? error.message : 'invitation could not be created',
        403
      )
    }
  }

  const revokeRoute = url.pathname.match(/^\/operators\/invitations\/([^/]+)\/revoke$/)
  if (request.method === 'POST' && revokeRoute) {
    const reference = await readOperatorSessionReference({
      auth,
      headers: request.headers
    })
    if (!reference) return redirect('/sign-in')
    try {
      await runInvitations(db, (invitations) =>
        invitations.revoke({
          actor: reference,
          invitationId: decodeURIComponent(revokeRoute[1]!)
        })
      )
      return redirect('/operators?result=invitation-revoked')
    } catch (error) {
      return enrollmentError(
        error instanceof Error ? error.message : 'revoke failed',
        403
      )
    }
  }

  if (request.method === 'POST' && url.pathname === '/enroll/accept') {
    const form = await request.formData()
    const token = text(form, 'token')
    const password = text(form, 'password')
    if (password.length < 12)
      return enrollmentError('Password must be at least 12 characters.')
    const credential = randomCredential()
    const [tokenHash, enrollmentTokenHash, passwordHash] = await Promise.all([
      hashCredential(token),
      hashCredential(credential),
      hashOperatorEnrollmentPassword(password)
    ])
    try {
      await runInvitations(db, (invitations) =>
        invitations.accept({
          tokenHash,
          enrollmentTokenHash,
          name: text(form, 'name'),
          passwordHash
        })
      )
      return redirect('/enroll/security', [enrollmentCookie(credential, config)])
    } catch (error) {
      return enrollmentError(
        error instanceof Error ? error.message : 'acceptance failed'
      )
    }
  }

  if (request.method === 'POST' && url.pathname === '/enroll/sign-out') {
    return redirect('/sign-in', [enrollmentCookie('', config, 0)])
  }

  const enrollmentStateRequest =
    request.method === 'GET' && url.pathname === '/api/operations/enrollment'
  if (!url.pathname.startsWith('/enroll/security') && !enrollmentStateRequest)
    return null
  const credential = cookieValue(request)
  if (!credential)
    return Response.json({ error: 'enrollment_expired' }, { status: 410 })
  const enrollmentTokenHash = await hashCredential(credential)
  let state
  try {
    state = await runInvitations(db, (invitations) =>
      invitations.inspect({ enrollmentTokenHash })
    )
  } catch {
    return Response.json({ error: 'enrollment_expired' }, { status: 410 })
  }

  if (enrollmentStateRequest) return Response.json({ email: state.email })

  if (request.method === 'POST' && url.pathname === '/enroll/security/start') {
    const form = await request.formData()
    try {
      const setup = await beginOperatorTwoFactorEnrollment({
        db,
        secret: config.secret,
        operatorId: state.operatorId,
        password: text(form, 'password')
      })
      return Response.json(setup)
    } catch (error) {
      return enrollmentError(error instanceof Error ? error.message : 'setup failed')
    }
  }

  if (request.method === 'POST' && url.pathname === '/enroll/security/complete') {
    const form = await request.formData()
    try {
      if (text(form, 'backupCodesConfirmed') !== 'yes')
        throw new Error('backup codes must be confirmed')
      await verifyOperatorTwoFactorEnrollment({
        auth,
        db,
        secret: config.secret,
        operatorId: state.operatorId,
        code: text(form, 'code')
      })
      await runInvitations(db, (invitations) =>
        invitations.complete({ enrollmentTokenHash })
      )
      return redirect('/sign-in?result=enrollment-complete', [
        enrollmentCookie('', config, 0)
      ])
    } catch (error) {
      await runInvitations(db, (invitations) =>
        invitations.complete({ enrollmentTokenHash })
      ).catch(() => undefined)
      return enrollmentError(
        error instanceof Error ? error.message : 'completion failed'
      )
    }
  }

  return Response.json({ error: 'not_found' }, { status: 404 })
}
