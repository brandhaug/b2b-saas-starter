import { Schema } from 'effect'
import type {
  AvailabilityOffer,
  OfferBookingResult,
  WaitingListApplicationRecord
} from '@b2b-saas-starter/capabilities/waiting-list'
import {
  WaitingListCustomer,
  WaitingListRequest
} from '@b2b-saas-starter/capabilities/waiting-list'

const Apply = Schema.Struct({
  shopId: Schema.String,
  request: WaitingListRequest,
  customer: WaitingListCustomer,
  expiresAt: Schema.String
})

export type WaitingListHttpDependencies = {
  readonly apply: (
    input: typeof Apply.Type & {
      id: string
      merchantSlug: string
      capability: string
      now: string
    }
  ) => Promise<WaitingListApplicationRecord>
  readonly withdraw: (
    applicationId: string,
    capability: string,
    now: string
  ) => Promise<WaitingListApplicationRecord>
  readonly inspectApplication: (
    applicationId: string,
    capability: string,
    now: string
  ) => Promise<WaitingListApplicationRecord>
  readonly inspect: (
    offerId: string,
    capability: string,
    now: string
  ) => Promise<AvailabilityOffer>
  readonly exchangeOfferAccess: (input: {
    offerId: string
    presentedCapability: string
    cookieCapability: string
    now: string
  }) => Promise<AvailabilityOffer>
  readonly decline: (
    offerId: string,
    capability: string,
    now: string
  ) => Promise<AvailabilityOffer>
  readonly accept: (
    offerId: string,
    capability: string,
    now: string
  ) => Promise<OfferBookingResult>
  readonly now: () => string
  readonly newApplicationId: () => string
  readonly newApplicationCapability: () => string
  readonly newOfferCookieCapability: () => string
  readonly authorizeReplacement: (input: {
    merchantSlug: string
    appointmentId: string
    routeId: string
    cookieCredential: string
    now: string
  }) => Promise<void>
}

const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { 'cache-control': 'no-store' } })
const cookieName = (offerId: string) => `__Host-availability-offer-${offerId}`
const cookie = (request: Request, name: string) =>
  request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1)
const failure = (error: unknown) => {
  const tag = (error as { _tag?: string })._tag
  if (tag === 'CapabilityUnavailable') return json({ state: 'unavailable' }, 503)
  if (tag === 'WaitingListInvalid') return json({ state: 'invalid' }, 409)
  return json({ state: 'not-found' }, 404)
}

export const handleWaitingListRequest = async (
  request: Request,
  dependencies: WaitingListHttpDependencies
): Promise<Response | null> => {
  const url = new URL(request.url)
  const replacementMatch = url.pathname.match(
    /^\/([^/]+)\/booking\/confirmations\/([^/]+)\/waiting-list$/
  )
  if (replacementMatch && request.method === 'POST') {
    try {
      const body = Schema.decodeUnknownSync(Apply)(await request.json())
      const appointmentId = body.request.replacementAppointmentId
      const routeId = replacementMatch[2]!
      const credential = cookie(request, `confirmation_${routeId}`)
      if (!appointmentId || !credential) return json({ state: 'not-found' }, 404)
      await dependencies.authorizeReplacement({
        merchantSlug: replacementMatch[1]!,
        appointmentId,
        routeId,
        cookieCredential: credential,
        now: dependencies.now()
      })
      const capability = dependencies.newApplicationCapability()
      const application = await dependencies.apply({
        ...body,
        request: { ...body.request, replacementConfirmationRouteId: routeId },
        id: dependencies.newApplicationId(),
        merchantSlug: replacementMatch[1]!,
        capability,
        now: dependencies.now()
      })
      return Response.json(application, {
        status: 201,
        headers: {
          'cache-control': 'no-store',
          'set-cookie': `__Host-waiting-list-${application.id}=${capability}; Path=/${replacementMatch[1]}/booking/waiting-list/${application.id}; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`
        }
      })
    } catch (error) {
      return failure(error)
    }
  }
  const applicationMatch = url.pathname.match(
    /^\/([^/]+)\/booking\/waiting-list(?:\/([^/]+))?$/
  )
  if (applicationMatch) {
    try {
      if (!applicationMatch[2] && request.method === 'POST') {
        const body = Schema.decodeUnknownSync(Apply)(await request.json())
        if (body.request.replacementAppointmentId) {
          const routeId = body.request.replacementConfirmationRouteId
          const credential = routeId
            ? cookie(request, `confirmation_${routeId}`)
            : undefined
          if (!routeId || !credential) return json({ state: 'not-found' }, 404)
          await dependencies.authorizeReplacement({
            merchantSlug: applicationMatch[1]!,
            appointmentId: body.request.replacementAppointmentId,
            routeId,
            cookieCredential: credential,
            now: dependencies.now()
          })
        }
        const capability = dependencies.newApplicationCapability()
        const application = await dependencies.apply({
          ...body,
          id: dependencies.newApplicationId(),
          merchantSlug: applicationMatch[1]!,
          capability,
          now: dependencies.now()
        })
        return Response.json(application, {
          status: 201,
          headers: {
            'cache-control': 'no-store',
            'set-cookie': `__Host-waiting-list-${application.id}=${capability}; Path=/${applicationMatch[1]}/booking/waiting-list/${application.id}; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`
          }
        })
      }
      if (applicationMatch[2] && request.method === 'DELETE') {
        const capability = cookie(request, `__Host-waiting-list-${applicationMatch[2]}`)
        if (!capability) return json({ state: 'not-found' }, 404)
        return json(
          await dependencies.withdraw(
            applicationMatch[2],
            capability,
            dependencies.now()
          )
        )
      }
      if (applicationMatch[2] && request.method === 'GET') {
        const capability = cookie(request, `__Host-waiting-list-${applicationMatch[2]}`)
        if (!capability) return json({ state: 'not-found' }, 404)
        const application = await dependencies.inspectApplication(
          applicationMatch[2],
          capability,
          dependencies.now()
        )
        return json({ state: application.status, application })
      }
      return null
    } catch (error) {
      return failure(error)
    }
  }

  const offerMatch = url.pathname.match(
    /^\/([^/]+)\/booking\/waiting-list\/([^/]+)\/offers\/([^/]+)$/
  )
  if (!offerMatch) return null
  const offerId = offerMatch[3]!
  const presented = url.searchParams.get('capability')
  if (presented && request.method === 'GET') {
    try {
      const cookieCapability = dependencies.newOfferCookieCapability()
      await dependencies.exchangeOfferAccess({
        offerId,
        presentedCapability: presented,
        cookieCapability,
        now: dependencies.now()
      })
      url.searchParams.delete('capability')
      return new Response(null, {
        status: 303,
        headers: {
          location: `${url.pathname}${url.search}`,
          'set-cookie': `${cookieName(offerId)}=${encodeURIComponent(cookieCapability)}; Path=${url.pathname}; HttpOnly; Secure; SameSite=Lax; Max-Age=86400`,
          'cache-control': 'no-store'
        }
      })
    } catch (error) {
      return failure(error)
    }
  }
  const capability = cookie(request, cookieName(offerId))
  if (!capability) return json({ state: 'not-found' }, 404)
  try {
    if (request.method === 'GET')
      return json({
        state: 'offer',
        offer: await dependencies.inspect(offerId, capability, dependencies.now())
      })
    if (request.method === 'DELETE')
      return json({
        state: 'declined',
        offer: await dependencies.decline(offerId, capability, dependencies.now())
      })
    if (request.method === 'POST') {
      const accepted = await dependencies.accept(
        offerId,
        capability,
        dependencies.now()
      )
      const { capability: sessionCapability, ...publicResult } = accepted
      const merchantSlug = offerMatch[1]!
      return Response.json(
        {
          state: 'accepted',
          ...publicResult,
          sessionUrl: `/${merchantSlug}/booking/session/${accepted.bookingSessionId}`
        },
        {
          headers: {
            'cache-control': 'no-store',
            'set-cookie': `booking_session_${accepted.bookingSessionId}=${sessionCapability}; Path=/${merchantSlug}/booking; Max-Age=7200; HttpOnly; Secure; SameSite=Lax`
          }
        }
      )
    }
    return null
  } catch (error) {
    return failure(error)
  }
}
