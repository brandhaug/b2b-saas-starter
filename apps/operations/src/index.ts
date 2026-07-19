import type { D1Database } from '@cloudflare/workers-types'
import { createDb } from '@b2b-saas-starter/db/client'
import {
  createOperationsAuth,
  createOperationsAuthHandler,
  provisionLocalOperator,
  readOperatorSessionReference
} from '@b2b-saas-starter/auth/operations'
import {
  OperationsAuthorization,
  makeOperationsAuthorizationLayer
} from '@b2b-saas-starter/capabilities/operations'
import {
  clientKey,
  makeRateLimiter,
  type CloudflareRateLimit
} from '@b2b-saas-starter/rate-limit'
import { Effect, type Scope } from 'effect'
import { parseOperationsConfig, type OperationsEnvironment } from './config.ts'

export type OperationsWorkerEnv = OperationsEnvironment & {
  readonly DB: D1Database
  readonly RATE_LIMITER_OPERATIONS_AUTH?: CloudflareRateLimit
}

export const localOperatorFixture = {
  id: 'opr_local_operations',
  name: 'Local System Operator',
  email: 'operator@operations.local',
  password: 'local-operations-password',
  totpSecret: 'JBSWY3DPEHPK3PXP',
  roles: ['merchant-impersonator', 'impersonation-auditor', 'operator-manager']
} as const

const html = (title: string, body: string): Response =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{font-family:system-ui;background:#101417;color:#f5f7f8;max-width:44rem;margin:5rem auto;padding:0 1.5rem}main{border:1px solid #334048;padding:2rem;background:#172027}label,input,button{display:block;width:100%;box-sizing:border-box}input,button{margin:.5rem 0 1.25rem;padding:.75rem}button{cursor:pointer;background:#e7b85b;border:0;font-weight:700}code{color:#e7b85b}</style></head><body><main>${body}</main></body></html>`,
    {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store'
      }
    }
  )

const redirect = (location: string, cookies: readonly string[] = []): Response => {
  const headers = new Headers({ location, 'cache-control': 'no-store' })
  cookies.forEach((cookie) => headers.append('set-cookie', cookie))
  return new Response(null, { status: 303, headers })
}

const formText = (form: FormData, name: string): string => {
  const value = form.get(name)
  return typeof value === 'string' ? value : ''
}

let localSeed: Promise<void> | undefined

const runScoped = <A>(effect: Effect.Effect<A, never, Scope.Scope>): Promise<A> =>
  Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A>)

const authorize = async (
  db: ReturnType<typeof createDb>,
  reference: { readonly operatorSessionId: string }
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const authorization = yield* OperationsAuthorization
      return yield* authorization.authorize(reference)
    }).pipe(Effect.provide(makeOperationsAuthorizationLayer(db)))
  ).catch(() => null)

export const createOperationsWorker = () => ({
  async fetch(request: Request, env: OperationsWorkerEnv): Promise<Response> {
    let config
    try {
      config = parseOperationsConfig(env)
    } catch (error) {
      return Response.json(
        { error: 'operations_configuration_invalid', reason: String(error) },
        { status: 503 }
      )
    }
    const db = createDb(env.DB)
    if (config.localSeed) {
      localSeed ??= provisionLocalOperator({
        db,
        secret: config.secret,
        mode: config.localDevelopment ? 'development' : 'production',
        operator: localOperatorFixture
      })
      await localSeed
    }
    const auth = createOperationsAuth({ db, ...config })
    const authHandler = createOperationsAuthHandler({ auth, db })
    const url = new URL(request.url)

    if (url.pathname.startsWith('/api/auth/')) {
      const limiter = makeRateLimiter({
        binding: () => env.RATE_LIMITER_OPERATIONS_AUTH,
        fallbackLimits: { 'operator-authentication': 20 }
      })
      const allowed = await runScoped(
        limiter.take({
          bucket: 'operator-authentication',
          key: clientKey(request)
        })
      )
      return allowed
        ? authHandler(request)
        : Response.json({ error: 'rate_limited' }, { status: 429 })
    }

    if (request.method === 'GET' && url.pathname === '/sign-in') {
      return html(
        'Operations sign in',
        '<h1>Operations</h1><p>Sign in with the dedicated System Operator identity.</p><form method="post"><label>Email<input name="email" type="email" required autocomplete="username"></label><label>Password<input name="password" type="password" required autocomplete="current-password"></label><button type="submit">Continue</button></form>'
      )
    }
    if (request.method === 'POST' && url.pathname === '/sign-in') {
      const form = await request.formData()
      const response = await authHandler(
        new Request(`${config.baseURL}/api/auth/sign-in/email`, {
          method: 'POST',
          headers: { origin: config.baseURL, 'content-type': 'application/json' },
          body: JSON.stringify({
            email: formText(form, 'email'),
            password: formText(form, 'password')
          })
        })
      )
      if (!response.ok) return redirect('/sign-in?error=authentication_failed')
      return redirect('/verify-totp', response.headers.getSetCookie())
    }
    if (request.method === 'GET' && url.pathname === '/verify-totp') {
      return html(
        'Verify TOTP',
        '<h1>Two-factor verification</h1><p>Enter the current code from your authenticator.</p><form method="post"><label>Authentication code<input name="code" inputmode="numeric" autocomplete="one-time-code" required></label><button type="submit">Verify</button></form>'
      )
    }
    if (request.method === 'POST' && url.pathname === '/verify-totp') {
      const form = await request.formData()
      const response = await authHandler(
        new Request(`${config.baseURL}/api/auth/two-factor/verify-totp`, {
          method: 'POST',
          headers: {
            origin: config.baseURL,
            cookie: request.headers.get('cookie') ?? '',
            'content-type': 'application/json'
          },
          body: JSON.stringify({ code: formText(form, 'code'), trustDevice: false })
        })
      )
      if (!response.ok) return redirect('/verify-totp?error=invalid_code')
      return redirect('/', response.headers.getSetCookie())
    }

    const reference = await readOperatorSessionReference({
      auth,
      headers: request.headers
    })
    const principal = reference ? await authorize(db, reference) : null
    if (!principal) return redirect('/sign-in')
    if (request.method !== 'GET' || url.pathname !== '/') {
      return Response.json({ error: 'not_found' }, { status: 404 })
    }
    return html(
      'Operations',
      `<p>Protected Operations shell</p><h1>Welcome, ${principal.name}</h1><p>Signed in as <code>${principal.email}</code>.</p><p>Roles: ${principal.roles.join(', ')}</p>`
    )
  }
})

export default createOperationsWorker()
