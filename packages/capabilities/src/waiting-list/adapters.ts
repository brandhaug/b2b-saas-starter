import { Effect, Layer, Schema } from 'effect'
import { and, eq, gt, inArray, isNotNull, isNull, lte } from 'drizzle-orm'
import {
  availabilityOffers,
  appointments,
  batch,
  confirmationAccess,
  Database,
  merchants,
  notificationIntents,
  protectedAccessGrants,
  providers,
  providerServiceEligibility,
  scheduleRules,
  services,
  shops,
  timeSlotHolds,
  waitingListApplications
} from '@b2b-saas-starter/db'
import { CapabilityDenied, CapabilityUnavailable } from '../errors.ts'
import { hashSha256, randomHex } from '../internal/crypto.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { deriveSlots } from '../scheduling/scheduling.ts'
import {
  authorizeSubscriptionAccess,
  NEW_DEMAND_SUBSCRIPTION_SQL_VALUES
} from '../subscriptions/subscription-access.ts'
import {
  AvailabilityOfferUnavailable,
  PendingOfferExists,
  WaitingList,
  WaitingListApplicationUnavailable,
  WaitingListInvalid,
  WaitingListRequest,
  WaitingListCustomer,
  OfferedSlot,
  type AvailabilityOffer,
  type DeliveredAvailabilityOffer,
  type OfferBookingResult,
  type WaitingListApplicationRecord,
  type WaitingListShape
} from './waiting-list.ts'

const decodeRequest = (value: string) =>
  Schema.decodeUnknownSync(WaitingListRequest)(JSON.parse(value))
const decodeCustomer = (value: string) =>
  Schema.decodeUnknownSync(WaitingListCustomer)(JSON.parse(value))
const decodeSlot = (value: string) =>
  Schema.decodeUnknownSync(OfferedSlot)(JSON.parse(value))
const unavailable = () =>
  new AvailabilityOfferUnavailable({ message: 'Availability Offer unavailable' })
const applicationFromRow = (
  row: typeof waitingListApplications.$inferSelect
): WaitingListApplicationRecord => ({
  id: row.id,
  shopId: row.shopId,
  status: row.status,
  request: decodeRequest(row.requestJson),
  customer: decodeCustomer(row.customerSnapshotJson),
  createdAt: row.createdAt,
  expiresAt: row.expiresAt
})
const offerFromRow = (
  row: typeof availabilityOffers.$inferSelect
): AvailabilityOffer => ({
  id: row.id,
  applicationId: row.waitingListApplicationId,
  status: row.status,
  slot: decodeSlot(row.slotJson),
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
  respondedAt: row.respondedAt,
  bookingSessionId: row.bookingSessionId
})
const addMinutes = (instant: string, minutes: number) =>
  new Date(Date.parse(instant) + minutes * 60_000).toISOString()

export const LiveWaitingList: Layer.Layer<WaitingList, never, Database> = Layer.effect(
  WaitingList,
  Effect.gen(function* () {
    const db = yield* Database
    const pausePendingOffers = (applicationId: string, now: string) =>
      Effect.gen(function* () {
        const pending = yield* orUnavailable('waiting-list')(
          db
            .select({ id: availabilityOffers.id })
            .from(availabilityOffers)
            .where(
              and(
                eq(availabilityOffers.waitingListApplicationId, applicationId),
                eq(availabilityOffers.status, 'pending')
              )
            )
        )
        if (pending.length === 0) return
        const offerIds = pending.map(({ id }) => id)
        yield* orUnavailable('waiting-list')(
          batch(db, [
            db
              .update(availabilityOffers)
              .set({ status: 'superseded', respondedAt: now })
              .where(inArray(availabilityOffers.id, offerIds)),
            db
              .update(notificationIntents)
              .set({ status: 'cancelled', updatedAt: now })
              .where(
                and(
                  eq(notificationIntents.sourceType, 'availability-offer'),
                  inArray(notificationIntents.sourceId, offerIds),
                  inArray(notificationIntents.status, ['pending', 'failed'])
                )
              )
          ])
        )
      })
    const offersAllowed = (applicationId: string, shopId: string, now: string) =>
      authorizeSubscriptionAccess(db, { shopId }, 'new-demand').pipe(
        Effect.as(true),
        Effect.catchTag('CapabilityDenied', (denial) =>
          pausePendingOffers(applicationId, now).pipe(
            Effect.andThen(Effect.fail(denial))
          )
        )
      )
    const readAuthorized = (offerId: string, capability: string, now: string) =>
      Effect.gen(function* () {
        const capabilityHash = yield* Effect.promise(() => hashSha256(capability))
        const [row] = yield* orUnavailable('waiting-list')(
          db
            .select({ offer: availabilityOffers })
            .from(availabilityOffers)
            .innerJoin(
              protectedAccessGrants,
              and(
                eq(protectedAccessGrants.resourceType, 'availability-offer'),
                eq(protectedAccessGrants.resourceId, availabilityOffers.id),
                eq(protectedAccessGrants.capabilityHash, capabilityHash)
              )
            )
            .where(
              and(
                eq(availabilityOffers.id, offerId),
                eq(availabilityOffers.status, 'pending'),
                gt(availabilityOffers.expiresAt, now),
                gt(protectedAccessGrants.expiresAt, now)
              )
            )
            .limit(1)
        )
        return row?.offer
      })
    const readAuthorizedApplication = (
      applicationId: string,
      capability: string,
      now: string
    ) =>
      Effect.gen(function* () {
        const capabilityHash = yield* Effect.promise(() => hashSha256(capability))
        const [row] = yield* orUnavailable('waiting-list')(
          db
            .select({ application: waitingListApplications })
            .from(waitingListApplications)
            .innerJoin(
              protectedAccessGrants,
              and(
                eq(protectedAccessGrants.resourceType, 'waiting-list-application'),
                eq(protectedAccessGrants.resourceId, waitingListApplications.id),
                eq(protectedAccessGrants.capabilityHash, capabilityHash)
              )
            )
            .where(
              and(
                eq(waitingListApplications.id, applicationId),
                gt(protectedAccessGrants.expiresAt, now)
              )
            )
            .limit(1)
        )
        return row?.application
      })

    const acceptAtomically = (
      application: WaitingListApplicationRecord,
      offer: AvailabilityOffer,
      capabilityHash: string,
      now: string
    ): Effect.Effect<
      OfferBookingResult,
      AvailabilityOfferUnavailable | CapabilityUnavailable
    > =>
      Effect.gen(function* () {
        const [shop] = yield* orUnavailable('waiting-list')(
          db.select().from(shops).where(eq(shops.id, application.shopId)).limit(1)
        )
        const [provider] = yield* orUnavailable('waiting-list')(
          db
            .select()
            .from(providers)
            .where(eq(providers.id, offer.slot.providerId))
            .limit(1)
        )
        const selectedServices = yield* orUnavailable('waiting-list')(
          db
            .select()
            .from(services)
            .where(inArray(services.id, [...application.request.serviceIds]))
        )
        if (
          !shop ||
          !provider ||
          provider.merchantId !== shop.merchantId ||
          provider.status !== 'active' ||
          selectedServices.length !== application.request.serviceIds.length ||
          selectedServices.some(
            (service) =>
              service.merchantId !== shop.merchantId || service.status !== 'active'
          )
        )
          return yield* unavailable()
        if (application.request.replacementAppointmentId) {
          if (!application.request.replacementConfirmationRouteId)
            return yield* unavailable()
          const [replacement] = yield* orUnavailable('waiting-list')(
            db
              .select()
              .from(appointments)
              .where(eq(appointments.id, application.request.replacementAppointmentId))
              .limit(1)
          )
          const [access] = yield* orUnavailable('waiting-list')(
            db
              .select()
              .from(confirmationAccess)
              .where(
                and(
                  eq(
                    confirmationAccess.routeId,
                    application.request.replacementConfirmationRouteId
                  ),
                  eq(
                    confirmationAccess.appointmentId,
                    application.request.replacementAppointmentId
                  ),
                  isNotNull(confirmationAccess.exchangedAt),
                  isNull(confirmationAccess.revokedAt),
                  gt(confirmationAccess.expiresAt, now)
                )
              )
              .limit(1)
          )
          if (
            !access ||
            !replacement ||
            replacement.merchantId !== shop.merchantId ||
            replacement.status !== 'scheduled'
          )
            return yield* unavailable()
        }
        const sessionId = newCapabilityId('bsn')
        const partyId = newCapabilityId('bpt')
        const requestId = newCapabilityId('brq')
        const holdId = newCapabilityId('hld')
        const routeId = newCapabilityId('brt')
        const sessionCapability = randomHex(32)
        const sessionCapabilityHash = yield* Effect.promise(() =>
          hashSha256(sessionCapability)
        )
        const holdExpiresAt = addMinutes(now, 10)
        const quote = {
          startsAt: offer.slot.startsAt,
          endsAt: offer.slot.endsAt,
          providerPreference: application.request.providerPreference,
          assignedProvider: { id: provider.id, displayName: provider.displayName },
          services: selectedServices.map((service, position) => ({
            id: service.id,
            role: position === 0 ? ('primary' as const) : ('additional' as const),
            name: service.name,
            durationMinutes: service.durationMinutes,
            priceMinor: service.priceMinor,
            currency: service.currency
          })),
          durationMinutes: selectedServices.reduce(
            (total, service) => total + service.durationMinutes,
            0
          ),
          currency: shop.currency,
          totalMinor: selectedServices.reduce(
            (total, service) => total + service.priceMinor,
            0
          )
        }
        const raw = db.$client.config.db
        const statements = [
          raw
            .prepare(`INSERT INTO booking_sessions (id, route_id, merchant_id, capability_hash, checkout_path, lifecycle, provider_preference, provider_id, primary_service_id, customer_name, customer_email, customer_phone, locale, embedding_profile, acquisition_json, created_at, last_activity_at, idle_expires_at, absolute_expires_at)
            SELECT ?, ?, ?, ?, 'pay_in_person', 'active', ?, ?, ?, ?, ?, ?, 'en', 'standalone', ?, ?, ?, ?, ?
            FROM availability_offers ao JOIN waiting_list_applications wa ON wa.id = ao.waiting_list_application_id
            JOIN protected_access_grants pag ON pag.resource_type = 'availability-offer' AND pag.resource_id = ao.id
            WHERE ao.id = ? AND ao.status = 'pending' AND ao.expires_at > ? AND wa.status = 'active' AND wa.expires_at > ? AND pag.capability_hash = ? AND pag.expires_at > ? AND pag.consumed_at IS NULL`)
            .bind(
              sessionId,
              routeId,
              shop.merchantId,
              sessionCapabilityHash,
              application.request.providerPreference.kind,
              provider.id,
              application.request.serviceIds[0]!,
              application.customer.name,
              application.customer.email,
              application.customer.phone ?? null,
              JSON.stringify(
                application.request.replacementAppointmentId
                  ? {
                      purpose: 'appointment-replacement',
                      appointmentId: application.request.replacementAppointmentId
                    }
                  : { purpose: 'availability-offer' }
              ),
              now,
              now,
              addMinutes(now, 30),
              addMinutes(now, 120),
              offer.id,
              now,
              now,
              capabilityHash,
              now
            ),
          raw
            .prepare(
              `INSERT INTO booking_parties (id, booking_session_id, shop_id, active_request_id, lifecycle, currency, locale, version, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', ?, 'en', 1, ?, ?)`
            )
            .bind(partyId, sessionId, shop.id, requestId, shop.currency, now, now),
          raw
            .prepare(
              `INSERT INTO booking_requests (id, booking_party_id, position, provider_preference, provider_id, primary_service_id, hold_id, customer_details_json, starts_at, ends_at, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(
              requestId,
              partyId,
              application.request.providerPreference.kind,
              provider.id,
              application.request.serviceIds[0]!,
              holdId,
              JSON.stringify(application.customer),
              offer.slot.startsAt,
              offer.slot.endsAt,
              now,
              now
            ),
          ...selectedServices.map((service, position) =>
            raw
              .prepare(
                `INSERT INTO booking_request_services (booking_request_id, service_id, role, position, created_at) VALUES (?, ?, ?, ?, ?)`
              )
              .bind(
                requestId,
                service.id,
                position === 0 ? 'primary' : 'additional',
                position,
                now
              )
          ),
          raw
            .prepare(
              `INSERT INTO time_slot_holds (id, merchant_id, booking_session_id, booking_request_id, provider_id, starts_at, ends_at, created_at, expires_at, quote) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(
              holdId,
              shop.merchantId,
              sessionId,
              requestId,
              provider.id,
              offer.slot.startsAt,
              offer.slot.endsAt,
              now,
              holdExpiresAt,
              JSON.stringify(quote)
            ),
          raw
            .prepare(
              `UPDATE availability_offers SET status = 'accepted', booking_session_id = ?, responded_at = ? WHERE id = ? AND status = 'pending'`
            )
            .bind(sessionId, now, offer.id),
          raw
            .prepare(
              `UPDATE waiting_list_applications SET status = 'fulfilled', updated_at = ? WHERE id = ? AND status = 'active'`
            )
            .bind(now, application.id),
          raw
            .prepare(
              `UPDATE protected_access_grants SET consumed_at = ? WHERE resource_type = 'availability-offer' AND resource_id = ? AND capability_hash = ? AND consumed_at IS NULL`
            )
            .bind(now, offer.id, capabilityHash)
        ]
        yield* Effect.tryPromise({
          try: () => raw.batch(statements),
          catch: () => unavailable()
        })
        return {
          bookingSessionId: sessionId,
          timeSlotHoldId: holdId,
          routeId,
          capability: sessionCapability,
          purpose: application.request.replacementAppointmentId
            ? 'appointment-replacement'
            : 'new-booking',
          ...(application.request.replacementAppointmentId
            ? {
                replacementAppointmentId: application.request.replacementAppointmentId
              }
            : {})
        }
      })

    const service: WaitingListShape = {
      apply: (input) =>
        Effect.gen(function* () {
          if (input.request.serviceIds.length === 0)
            return yield* new WaitingListInvalid({ reason: 'services_required' })
          if (input.request.from >= input.request.until || input.expiresAt <= input.now)
            return yield* new WaitingListInvalid({ reason: 'invalid_date_window' })
          const [ownedShop] = yield* orUnavailable('waiting-list')(
            db
              .select({ id: shops.id })
              .from(shops)
              .innerJoin(merchants, eq(merchants.id, shops.merchantId))
              .where(
                and(eq(shops.id, input.shopId), eq(merchants.slug, input.merchantSlug))
              )
              .limit(1)
          )
          if (!ownedShop)
            return yield* new WaitingListInvalid({
              reason: 'candidate_ineligible'
            })
          yield* authorizeSubscriptionAccess(db, { shopId: input.shopId }, 'new-demand')
          const capabilityHash = yield* Effect.promise(() =>
            hashSha256(input.capability)
          )
          const raw = db.$client.config.db
          const committed = yield* Effect.tryPromise({
            try: () =>
              raw.batch([
                raw
                  .prepare(
                    `INSERT INTO waiting_list_applications
                     (id,shop_id,status,request_json,customer_snapshot_json,created_at,updated_at,expires_at)
                     SELECT ?,?,'active',?,?,?,?,? WHERE EXISTS (
                       SELECT 1 FROM shops shop
                       INNER JOIN merchant_subscriptions subscription
                         ON subscription.merchant_id=shop.merchant_id
                       WHERE shop.id=? AND subscription.status IN (${NEW_DEMAND_SUBSCRIPTION_SQL_VALUES}))`
                  )
                  .bind(
                    input.id,
                    input.shopId,
                    JSON.stringify(input.request),
                    JSON.stringify(input.customer),
                    input.now,
                    input.now,
                    input.expiresAt,
                    input.shopId
                  ),
                raw
                  .prepare(
                    `INSERT INTO protected_access_grants
                     (id,shop_id,purpose,resource_type,resource_id,capability_hash,expires_at,created_at)
                     SELECT ?,?,'waiting-list-application','waiting-list-application',?,?,?,?
                     WHERE EXISTS (SELECT 1 FROM waiting_list_applications
                       WHERE id=? AND shop_id=?)
                     AND EXISTS (
                       SELECT 1 FROM shops shop
                       INNER JOIN merchant_subscriptions subscription
                         ON subscription.merchant_id=shop.merchant_id
                       WHERE shop.id=? AND subscription.status IN (${NEW_DEMAND_SUBSCRIPTION_SQL_VALUES}))`
                  )
                  .bind(
                    newCapabilityId('pag'),
                    input.shopId,
                    input.id,
                    capabilityHash,
                    addMinutes(input.expiresAt, 30 * 24 * 60),
                    input.now,
                    input.id,
                    input.shopId,
                    input.shopId
                  )
              ]),
            catch: (cause) =>
              new CapabilityUnavailable({
                capability: 'waiting-list',
                reason: String(cause)
              })
          })
          if ((committed[0]?.meta.changes ?? 0) < 1)
            return yield* Effect.fail(
              new CapabilityDenied({ reason: 'restricted_access' })
            )
          return {
            id: input.id,
            shopId: input.shopId,
            status: 'active',
            request: input.request,
            customer: input.customer,
            createdAt: input.now,
            expiresAt: input.expiresAt
          }
        }),
      withdraw: (applicationId, capability, now) =>
        Effect.gen(function* () {
          const row = yield* readAuthorizedApplication(applicationId, capability, now)
          if (!row)
            return yield* new WaitingListApplicationUnavailable({ applicationId })
          if (row.status !== 'active')
            return yield* new WaitingListInvalid({ reason: 'application_inactive' })
          const raw = db.$client.config.db
          const results = yield* Effect.tryPromise({
            try: () =>
              raw.batch([
                raw
                  .prepare(
                    "UPDATE waiting_list_applications SET status = 'withdrawn', updated_at = ? WHERE id = ? AND status = 'active'"
                  )
                  .bind(now, applicationId),
                raw
                  .prepare(
                    "UPDATE availability_offers SET status = 'superseded', responded_at = ? WHERE waiting_list_application_id = ? AND status = 'pending'"
                  )
                  .bind(now, applicationId)
              ]),
            catch: () =>
              new CapabilityUnavailable({
                capability: 'waiting-list',
                reason: 'withdraw-failed'
              })
          })
          if ((results[0]?.meta.changes ?? 0) !== 1)
            return yield* new WaitingListInvalid({ reason: 'application_inactive' })
          return { ...applicationFromRow(row), status: 'withdrawn' }
        }),
      inspectApplication: (applicationId, capability, now) =>
        Effect.flatMap(
          readAuthorizedApplication(applicationId, capability, now),
          (row) =>
            row
              ? Effect.succeed(applicationFromRow(row))
              : Effect.fail(new WaitingListApplicationUnavailable({ applicationId }))
        ),
      offer: (input) =>
        Effect.gen(function* () {
          const [application] = yield* orUnavailable('waiting-list')(
            db
              .select()
              .from(waitingListApplications)
              .where(eq(waitingListApplications.id, input.applicationId))
              .limit(1)
          )
          if (!application)
            return yield* new WaitingListApplicationUnavailable({
              applicationId: input.applicationId
            })
          if (application.status !== 'active' || application.expiresAt <= input.now)
            return yield* new WaitingListInvalid({ reason: 'application_inactive' })
          yield* offersAllowed(application.id, application.shopId, input.now)
          const request = decodeRequest(application.requestJson)
          const slotEligible =
            input.slot.shopId === application.shopId &&
            input.slot.startsAt >= request.from &&
            input.slot.endsAt <= request.until &&
            request.serviceIds.every((serviceId) =>
              input.slot.serviceIds.includes(serviceId)
            ) &&
            (request.providerPreference.kind === 'any' ||
              request.providerPreference.providerId === input.slot.providerId)
          const eligibleServices = slotEligible
            ? yield* orUnavailable('waiting-list')(
                db
                  .select({ serviceId: providerServiceEligibility.serviceId })
                  .from(providerServiceEligibility)
                  .where(
                    and(
                      eq(providerServiceEligibility.providerId, input.slot.providerId),
                      inArray(providerServiceEligibility.serviceId, [
                        ...request.serviceIds
                      ])
                    )
                  )
              )
            : []
          if (!slotEligible || eligibleServices.length !== request.serviceIds.length)
            return yield* new WaitingListInvalid({
              reason: 'candidate_ineligible'
            })
          const [existingPending] = yield* orUnavailable('waiting-list')(
            db
              .select()
              .from(availabilityOffers)
              .where(
                and(
                  eq(availabilityOffers.waitingListApplicationId, input.applicationId),
                  eq(availabilityOffers.status, 'pending')
                )
              )
              .limit(1)
          )
          if (existingPending?.id === input.id) return offerFromRow(existingPending)
          if (existingPending)
            return yield* new PendingOfferExists({
              applicationId: input.applicationId
            })
          const capabilityHash = yield* Effect.promise(() =>
            hashSha256(input.capability)
          )
          const grantId = newCapabilityId('pag')
          const intentId = newCapabilityId('nti')
          yield* orUnavailable('waiting-list')(
            batch(db, [
              db.insert(availabilityOffers).values({
                id: input.id,
                waitingListApplicationId: input.applicationId,
                status: 'pending',
                slotJson: JSON.stringify(input.slot),
                createdAt: input.now,
                expiresAt: input.expiresAt
              }),
              db.insert(protectedAccessGrants).values({
                id: grantId,
                shopId: application.shopId,
                purpose: 'availability-offer',
                resourceType: 'availability-offer',
                resourceId: input.id,
                capabilityHash,
                expiresAt: input.expiresAt,
                createdAt: input.now
              }),
              db.insert(notificationIntents).values({
                id: intentId,
                shopId: application.shopId,
                topic: 'availability-offer.created',
                recipientJson: application.customerSnapshotJson,
                payloadJson: JSON.stringify({ offerId: input.id }),
                sourceType: 'availability-offer',
                sourceId: input.id,
                deduplicationKey: `availability-offer.created:${input.id}`,
                status: 'pending',
                availableAt: input.now,
                createdAt: input.now,
                updatedAt: input.now
              })
            ])
          )
          return {
            id: input.id,
            applicationId: input.applicationId,
            status: 'pending',
            slot: input.slot,
            createdAt: input.now,
            expiresAt: input.expiresAt,
            respondedAt: null,
            bookingSessionId: null
          }
        }),
      inspectOffer: (id, capability, now) =>
        Effect.flatMap(readAuthorized(id, capability, now), (row) =>
          row ? Effect.succeed(offerFromRow(row)) : Effect.fail(unavailable())
        ),
      exchangeOfferAccess: (input) =>
        Effect.gen(function* () {
          const row = yield* readAuthorized(
            input.offerId,
            input.presentedCapability,
            input.now
          )
          if (!row) return yield* unavailable()
          const presentedHash = yield* Effect.promise(() =>
            hashSha256(input.presentedCapability)
          )
          const cookieHash = yield* Effect.promise(() =>
            hashSha256(input.cookieCapability)
          )
          const result = yield* Effect.tryPromise({
            try: () =>
              db.$client.config.db
                .prepare(
                  "UPDATE protected_access_grants SET capability_hash = ? WHERE resource_type = 'availability-offer' AND resource_id = ? AND capability_hash = ? AND consumed_at IS NULL AND expires_at > ?"
                )
                .bind(cookieHash, input.offerId, presentedHash, input.now)
                .run(),
            catch: () => unavailable()
          })
          if ((result.meta.changes ?? 0) !== 1) return yield* unavailable()
          return offerFromRow(row)
        }),
      declineOffer: (id, capability, now) =>
        Effect.gen(function* () {
          const row = yield* readAuthorized(id, capability, now)
          if (!row) return yield* unavailable()
          const result = yield* Effect.tryPromise({
            try: () =>
              db.$client.config.db
                .prepare(
                  "UPDATE availability_offers SET status = 'declined', responded_at = ? WHERE id = ? AND status = 'pending'"
                )
                .bind(now, id)
                .run(),
            catch: () => unavailable()
          })
          if ((result.meta.changes ?? 0) !== 1) return yield* unavailable()
          return { ...offerFromRow(row), status: 'declined', respondedAt: now }
        }),
      acceptOffer: (id, capability, now) =>
        Effect.gen(function* () {
          const row = yield* readAuthorized(id, capability, now)
          if (!row) return yield* unavailable()
          const [applicationRow] = yield* orUnavailable('waiting-list')(
            db
              .select()
              .from(waitingListApplications)
              .where(eq(waitingListApplications.id, row.waitingListApplicationId))
              .limit(1)
          )
          if (!applicationRow) return yield* unavailable()
          const capabilityHash = yield* Effect.promise(() => hashSha256(capability))
          return yield* acceptAtomically(
            applicationFromRow(applicationRow),
            offerFromRow(row),
            capabilityHash,
            now
          )
        }),
      expire: (now) =>
        Effect.gen(function* () {
          const expiredOffers = yield* orUnavailable('waiting-list')(
            db
              .select({ id: availabilityOffers.id })
              .from(availabilityOffers)
              .where(
                and(
                  eq(availabilityOffers.status, 'pending'),
                  lte(availabilityOffers.expiresAt, now)
                )
              )
          )
          const expiredApplications = yield* orUnavailable('waiting-list')(
            db
              .select({ id: waitingListApplications.id })
              .from(waitingListApplications)
              .where(
                and(
                  eq(waitingListApplications.status, 'active'),
                  lte(waitingListApplications.expiresAt, now)
                )
              )
          )
          const supersededOffers =
            expiredApplications.length > 0
              ? yield* orUnavailable('waiting-list')(
                  db
                    .select({ id: availabilityOffers.id })
                    .from(availabilityOffers)
                    .where(
                      and(
                        eq(availabilityOffers.status, 'pending'),
                        inArray(
                          availabilityOffers.waitingListApplicationId,
                          expiredApplications.map(({ id }) => id)
                        )
                      )
                    )
                )
              : []
          const terminalOfferIds = [
            ...new Set([
              ...expiredOffers.map(({ id }) => id),
              ...supersededOffers.map(({ id }) => id)
            ])
          ]
          const expiryStatements = [
            db
              .update(availabilityOffers)
              .set({ status: 'expired' })
              .where(
                and(
                  eq(availabilityOffers.status, 'pending'),
                  lte(availabilityOffers.expiresAt, now)
                )
              ),
            ...(expiredApplications.length > 0
              ? [
                  db
                    .update(availabilityOffers)
                    .set({ status: 'superseded', respondedAt: now })
                    .where(
                      and(
                        eq(availabilityOffers.status, 'pending'),
                        inArray(
                          availabilityOffers.waitingListApplicationId,
                          expiredApplications.map(({ id }) => id)
                        )
                      )
                    )
                ]
              : []),
            db
              .update(waitingListApplications)
              .set({ status: 'expired', updatedAt: now })
              .where(
                and(
                  eq(waitingListApplications.status, 'active'),
                  lte(waitingListApplications.expiresAt, now)
                )
              ),
            ...(terminalOfferIds.length > 0
              ? [
                  db
                    .update(notificationIntents)
                    .set({ status: 'cancelled', updatedAt: now })
                    .where(
                      and(
                        eq(notificationIntents.sourceType, 'availability-offer'),
                        inArray(notificationIntents.sourceId, terminalOfferIds),
                        inArray(notificationIntents.status, ['pending', 'failed'])
                      )
                    )
                ]
              : [])
          ]
          yield* orUnavailable('waiting-list')(batch(db, expiryStatements))
          return {
            applications: expiredApplications.length,
            offers: expiredOffers.length
          }
        }),
      deliverAvailable: (now, deliveryKeyring) =>
        Effect.gen(function* () {
          const deliveryKey = deliveryKeyring.keys[deliveryKeyring.currentKeyId] ?? ''
          if (!deliveryKey)
            return yield* new CapabilityUnavailable({
              capability: 'waiting-list',
              reason: 'missing-delivery-key'
            })
          const applications = yield* orUnavailable('waiting-list')(
            db
              .select()
              .from(waitingListApplications)
              .where(eq(waitingListApplications.status, 'active'))
              .orderBy(waitingListApplications.createdAt, waitingListApplications.id)
          )
          const delivered: DeliveredAvailabilityOffer[] = []
          for (const row of applications) {
            const application = applicationFromRow(row)
            if (application.expiresAt <= now) continue
            const allowed = yield* offersAllowed(
              application.id,
              application.shopId,
              now
            ).pipe(Effect.catchTag('CapabilityDenied', () => Effect.succeed(false)))
            if (!allowed) continue
            const [pending] = yield* orUnavailable('waiting-list')(
              db
                .select()
                .from(availabilityOffers)
                .where(
                  and(
                    eq(availabilityOffers.waitingListApplicationId, row.id),
                    eq(availabilityOffers.status, 'pending'),
                    gt(availabilityOffers.expiresAt, now)
                  )
                )
                .limit(1)
            )
            if (pending) {
              const pendingOffer = offerFromRow(pending)
              const pendingKey =
                deliveryKeyring.keys[
                  pendingOffer.slot.deliveryKeyId ?? deliveryKeyring.legacyKeyId
                ] ?? ''
              if (!pendingKey)
                return yield* new CapabilityUnavailable({
                  capability: 'waiting-list',
                  reason: 'missing-delivery-key-version'
                })
              delivered.push({
                offer: pendingOffer,
                capability: yield* Effect.promise(() =>
                  hashSha256(`${pendingKey}:${pending.id}`)
                ),
                customer: application.customer,
                merchantSlug:
                  (yield* orUnavailable('waiting-list')(
                    db
                      .select({ slug: merchants.slug })
                      .from(merchants)
                      .innerJoin(shops, eq(shops.merchantId, merchants.id))
                      .where(eq(shops.id, application.shopId))
                      .limit(1)
                  ))[0]?.slug ?? ''
              })
              continue
            }
            const [shop] = yield* orUnavailable('waiting-list')(
              db.select().from(shops).where(eq(shops.id, row.shopId)).limit(1)
            )
            if (!shop) continue
            const [merchant] = yield* orUnavailable('waiting-list')(
              db
                .select()
                .from(merchants)
                .where(eq(merchants.id, shop.merchantId))
                .limit(1)
            )
            if (!merchant) continue
            const serviceRows = yield* orUnavailable('waiting-list')(
              db
                .select()
                .from(services)
                .where(
                  and(
                    inArray(services.id, [...application.request.serviceIds]),
                    eq(services.merchantId, shop.merchantId),
                    eq(services.status, 'active')
                  )
                )
            )
            if (serviceRows.length !== application.request.serviceIds.length) continue
            const eligibility = yield* orUnavailable('waiting-list')(
              db
                .select()
                .from(providerServiceEligibility)
                .where(
                  and(
                    inArray(providerServiceEligibility.serviceId, [
                      ...application.request.serviceIds
                    ]),
                    eq(providerServiceEligibility.merchantId, shop.merchantId)
                  )
                )
            )
            const providerIds = [
              ...new Set(eligibility.map(({ providerId }) => providerId))
            ]
              .filter(
                (providerId) =>
                  application.request.providerPreference.kind === 'any' ||
                  application.request.providerPreference.providerId === providerId
              )
              .filter((providerId) =>
                application.request.serviceIds.every((serviceId) =>
                  eligibility.some(
                    (item) =>
                      item.providerId === providerId && item.serviceId === serviceId
                  )
                )
              )
              .sort()
            const activeProviders = yield* orUnavailable('waiting-list')(
              db
                .select({ id: providers.id })
                .from(providers)
                .where(
                  and(
                    inArray(providers.id, providerIds),
                    eq(providers.merchantId, shop.merchantId),
                    eq(providers.status, 'active')
                  )
                )
            )
            const activeProviderIds = new Set(activeProviders.map(({ id }) => id))
            const duration = serviceRows.reduce(
              (sum, service) => sum + service.durationMinutes,
              0
            )
            let candidate:
              | { providerId: string; startsAt: string; endsAt: string }
              | undefined
            for (const providerId of providerIds.filter((id) =>
              activeProviderIds.has(id)
            )) {
              const rules = yield* orUnavailable('waiting-list')(
                db
                  .select()
                  .from(scheduleRules)
                  .where(eq(scheduleRules.providerId, providerId))
              )
              const generated = deriveSlots(
                rules,
                shop.timezone,
                duration,
                application.request.from > now ? application.request.from : now,
                31
              ).slots.filter((slot) => slot.endsAt <= application.request.until)
              const existingAppointments = yield* orUnavailable('waiting-list')(
                db
                  .select()
                  .from(appointments)
                  .where(eq(appointments.providerId, providerId))
              )
              const holds = yield* orUnavailable('waiting-list')(
                db
                  .select()
                  .from(timeSlotHolds)
                  .where(eq(timeSlotHolds.providerId, providerId))
              )
              const slot = generated.find(
                (item) =>
                  !existingAppointments.some(
                    (appointment) =>
                      appointment.status === 'scheduled' &&
                      appointment.startsAt < item.endsAt &&
                      appointment.endsAt > item.startsAt
                  ) &&
                  !holds.some(
                    (hold) =>
                      hold.expiresAt > now &&
                      hold.startsAt < item.endsAt &&
                      hold.endsAt > item.startsAt
                  )
              )
              if (slot) {
                candidate = { providerId, ...slot }
                break
              }
            }
            if (!candidate) continue
            const offerId = newCapabilityId('avo')
            const capability = yield* Effect.promise(() =>
              hashSha256(`${deliveryKey}:${offerId}`)
            )
            const issued = yield* Effect.result(
              service.offer({
                id: offerId,
                applicationId: application.id,
                slot: {
                  shopId: application.shopId,
                  serviceIds: [...application.request.serviceIds],
                  deliveryKeyId: deliveryKeyring.currentKeyId,
                  ...candidate
                },
                capability,
                now,
                expiresAt: addMinutes(now, 15)
              })
            )
            if (issued._tag === 'Failure') {
              if (
                issued.failure instanceof PendingOfferExists ||
                (issued.failure instanceof CapabilityUnavailable &&
                  issued.failure.reason.toLowerCase().includes('unique'))
              )
                continue
              return yield* issued.failure
            }
            delivered.push({
              offer: issued.success,
              capability,
              customer: application.customer,
              merchantSlug: merchant.slug
            })
          }
          return delivered
        }),
      claimOfferDelivery: (offerId, now) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: () =>
              db.$client.config.db
                .prepare(
                  "UPDATE notification_intents SET status = 'processing', updated_at = ? WHERE source_type = 'availability-offer' AND source_id = ? AND status IN ('pending', 'failed') AND EXISTS (SELECT 1 FROM availability_offers WHERE availability_offers.id = notification_intents.source_id AND availability_offers.status = 'pending' AND availability_offers.expires_at > ?)"
                )
                .bind(now, offerId, now)
                .run(),
            catch: () =>
              new CapabilityUnavailable({
                capability: 'waiting-list',
                reason: 'delivery-claim-failed'
              })
          })
          return (result?.meta.changes ?? 0) === 1
        })
    }
    return service
  })
)
