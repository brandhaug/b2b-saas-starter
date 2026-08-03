import { createServerFn, createServerOnlyFn } from '@tanstack/react-start'
import { getRequest, setResponseHeader } from '@tanstack/react-start/server'
import { env } from 'cloudflare:workers'
import { constantTimeEqual, makeSignature } from 'better-auth/crypto'
import { Effect } from 'effect'
import {
  OperationsImpersonationLifecycle,
  makeOperationsImpersonationLifecycleLayer,
  type ImpersonationLifecycleResolution
} from '@b2b-saas-starter/capabilities/operations'
import { CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import { createMerchantServerContext } from '../server-context.ts'

type MerchantSession = {
  readonly session: {
    readonly id: string
    readonly impersonatedBy?: string | null | undefined
  }
}

type MerchantLifecycleResolution =
  | Extract<ImpersonationLifecycleResolution, { state: 'active' }>
  | (Extract<ImpersonationLifecycleResolution, { state: 'terminated' }> & {
      readonly returnTo: string
    })

const operationsReturnTo = (
  origin: string,
  resolution: Extract<ImpersonationLifecycleResolution, { state: 'terminated' }>
): string =>
  `${origin}/merchants/${encodeURIComponent(resolution.merchantId)}/members/${encodeURIComponent(resolution.targetMemberId)}`

export const clearImpersonationCookie = (production: boolean): string =>
  `${production ? '__Secure-' : ''}merchant.session_token=; Max-Age=0; Path=/; HttpOnly;${production ? ' Secure;' : ''} SameSite=Lax`

export const verifiedMerchantSessionToken = async (input: {
  readonly cookie: string
  readonly secret: string
  readonly production: boolean
}): Promise<string | null> => {
  const cookieName = `${input.production ? '__Secure-' : ''}merchant.session_token=`
  const encoded = input.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(cookieName))
    ?.slice(cookieName.length)
  if (!encoded) return null
  let signed: string
  try {
    signed = decodeURIComponent(encoded)
  } catch {
    return null
  }
  const separator = signed.lastIndexOf('.')
  if (separator <= 0) return null
  const token = signed.slice(0, separator)
  const signature = signed.slice(separator + 1)
  const expected = await makeSignature(token, input.secret)
  return constantTimeEqual(signature, expected) ? token : null
}

export const resolveMerchantImpersonationLifecycle = async (input: {
  readonly session: MerchantSession | null
  readonly resolve: (
    merchantSessionId: string
  ) => Promise<ImpersonationLifecycleResolution>
  readonly operationsOrigin: string
}): Promise<MerchantLifecycleResolution | null> => {
  if (!input.session?.session.impersonatedBy) return null
  const resolution = await input.resolve(input.session.session.id)
  return resolution.state === 'active'
    ? resolution
    : {
        ...resolution,
        returnTo: operationsReturnTo(input.operationsOrigin, resolution)
      }
}

const runLifecycle = createServerOnlyFn(async (action: 'resolve' | 'stop') => {
  const request = getRequest()
  const context = createMerchantServerContext()
  let session: MerchantSession | null = await context
    .auth()
    .api.getSession({ headers: request.headers })
  if (!session) {
    const token = await verifiedMerchantSessionToken({
      cookie: request.headers.get('cookie') ?? '',
      secret: context.merchantSecret(),
      production: context.production()
    })
    if (token) {
      const presented = await env.DB.prepare(
        'SELECT id, impersonatedBy FROM session WHERE token = ?1 LIMIT 1'
      )
        .bind(token)
        .first<{ readonly id: string; readonly impersonatedBy: string | null }>()
      session = presented ? { session: presented } : null
    }
  }
  const operationsOrigin = env.OPERATIONS_APP_ORIGIN
  if (!session?.session.impersonatedBy) return null
  if (!operationsOrigin)
    throw new CapabilityUnavailable({
      capability: 'operations-impersonation-lifecycle',
      reason: 'impersonation lifecycle configuration is unavailable'
    })
  const layer = makeOperationsImpersonationLifecycleLayer(context.db(), {
    securityContact: env.OPERATIONS_SECURITY_CONTACT ?? ''
  })
  const resolution = await resolveMerchantImpersonationLifecycle({
    session,
    operationsOrigin,
    resolve: (merchantSessionId) =>
      Effect.runPromise(
        Effect.flatMap(OperationsImpersonationLifecycle, (lifecycle) =>
          action === 'stop'
            ? lifecycle.stop({ merchantSessionId })
            : lifecycle.resolve({ merchantSessionId })
        ).pipe(Effect.provide(layer))
      )
  })
  if (resolution?.state === 'terminated') {
    setResponseHeader('set-cookie', clearImpersonationCookie(context.production()))
  }
  return resolution
})

export const getImpersonationLifecycle = createServerFn({ method: 'GET' }).handler(() =>
  runLifecycle('resolve')
)

export const stopImpersonation = createServerFn({ method: 'POST' }).handler(() =>
  runLifecycle('stop')
)
