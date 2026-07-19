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
import type { OperationsConfig } from './config.ts'
import type { OperatorInvitationDelivery } from './operations-email.ts'
import { escapeHtml, html, redirect } from './operations-response.ts'

const enrollmentCookieName = 'operations.enrollment'

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
  `${enrollmentCookieName}=${credential}; Path=/enroll; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${config.production ? '; Secure' : ''}`

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
        typeof role === 'string' && operatorRoleNames.includes(role as OperatorRole)
    )

const invitationForm = (): string =>
  `<p><a href="/operators">Back to System Operators</a></p><h1>Invite System Operator</h1><form method="post" action="/operators/invitations"><label>Email<input name="email" type="email" required></label>${operatorRoleNames.map((role) => `<label><input type="checkbox" name="roles" value="${role}">${escapeHtml(role)}</label>`).join('')}<button type="submit">Create invitation</button></form>`

const enrollmentError = (message: string, status = 400): Response =>
  html(
    'Operator enrollment',
    `<h1>Enrollment unavailable</h1><p>${escapeHtml(message)}</p>`,
    status
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

  if (request.method === 'GET' && url.pathname === '/operators/invitations/new') {
    const reference = await readOperatorSessionReference({
      auth,
      headers: request.headers
    })
    if (!reference) return redirect('/sign-in')
    return html('Invite System Operator', invitationForm())
  }

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
      return html(
        'Operator invitation sent',
        `<h1>Operator invitation sent</h1><p>A single-use email-verification and enrollment link was sent to ${escapeHtml(invitation.email)}. It expires at ${escapeHtml(invitation.expiresAt.toISOString())}.</p><form method="post" action="/operators/invitations/${encodeURIComponent(invitation.id)}/revoke"><button type="submit">Revoke invitation</button></form>`
      )
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

  if (request.method === 'GET' && url.pathname === '/enroll') {
    const token = url.searchParams.get('token') ?? ''
    if (!token) return enrollmentError('Invitation token is required.')
    return html(
      'Accept operator invitation',
      `<h1>Accept operator invitation</h1><form method="post" action="/enroll/accept"><input type="hidden" name="token" value="${escapeHtml(token)}"><label>Name<input name="name" required autocomplete="name"></label><label>Password<input name="password" type="password" minlength="12" required autocomplete="new-password"></label><button type="submit">Begin security enrollment</button></form>`
    )
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

  if (!url.pathname.startsWith('/enroll/security')) return null
  const credential = cookieValue(request)
  if (!credential) return enrollmentError('Enrollment session is unavailable.', 401)
  const enrollmentTokenHash = await hashCredential(credential)
  let state
  try {
    state = await runInvitations(db, (invitations) =>
      invitations.inspect({ enrollmentTokenHash })
    )
  } catch {
    return enrollmentError('Enrollment session expired. Sign in to resume.', 401)
  }

  if (request.method === 'GET' && url.pathname === '/enroll/security') {
    return html(
      'Operator security enrollment',
      `<h1>Secure ${escapeHtml(state.email)}</h1><p>This enrollment-only session has no Operations permissions.</p><form method="post" action="/enroll/security/start"><label>Confirm password<input name="password" type="password" required autocomplete="current-password"></label><button type="submit">Set up authenticator and backup codes</button></form><form method="post" action="/enroll/sign-out"><button type="submit">Sign out of enrollment</button></form>`
    )
  }

  if (request.method === 'POST' && url.pathname === '/enroll/security/start') {
    const form = await request.formData()
    try {
      const setup = await beginOperatorTwoFactorEnrollment({
        db,
        secret: config.secret,
        operatorId: state.operatorId,
        password: text(form, 'password')
      })
      return html(
        'Confirm operator security',
        `<h1>Confirm operator security</h1><p>Authenticator URI: <code>${escapeHtml(setup.totpURI)}</code></p><h2>Backup codes</h2><ul>${setup.backupCodes.map((code) => `<li><code>${escapeHtml(code)}</code></li>`).join('')}</ul><form method="post" action="/enroll/security/complete"><label>Authentication code<input name="code" inputmode="numeric" required autocomplete="one-time-code"></label><label><input name="backupCodesConfirmed" type="checkbox" value="yes" required>I stored my backup codes</label><button type="submit">Complete enrollment</button></form><form method="post" action="/enroll/sign-out"><button type="submit">Sign out of enrollment</button></form>`
      )
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
