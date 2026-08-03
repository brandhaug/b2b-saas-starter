import { Schema } from 'effect'
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema
} from 'effect/unstable/httpapi'
import {
  WalkInEnrollment,
  WalkInOverview,
  WalkInQueueEntry
} from '@b2b-saas-starter/capabilities/walk-ins'

const ShopPath = Schema.Struct({
  merchantSlug: Schema.String,
  shopSlug: Schema.String
})
const EntryPath = Schema.Struct({
  merchantSlug: Schema.String,
  shopSlug: Schema.String,
  entryId: Schema.String
})
export const WalkInEnrollmentPayload = Schema.Struct({
  serviceId: WalkInEnrollment.fields.serviceId,
  providerPreference: WalkInEnrollment.fields.providerPreference,
  customerDetails: WalkInEnrollment.fields.customerDetails,
  locale: WalkInEnrollment.fields.locale
})
export const WalkInEnrollmentResponse = Schema.Struct({
  entry: WalkInQueueEntry,
  location: Schema.String
}).pipe(HttpApiSchema.status(201))
const WalkInHttpErrors = [
  Schema.Struct({ error: Schema.Literal('walk_in_invalid') }).pipe(
    HttpApiSchema.status(400)
  ),
  Schema.Struct({
    error: Schema.Literals(['walk_ins_closed', 'walk_in_duplicate'])
  }).pipe(HttpApiSchema.status(409)),
  Schema.Struct({ error: Schema.Literal('walk_in_not_found') }).pipe(
    HttpApiSchema.status(404)
  ),
  Schema.Struct({ error: Schema.Literal('walk_ins_unavailable') }).pipe(
    HttpApiSchema.status(503)
  )
] as const

export const WalkInHttpGroup = HttpApiGroup.make('walk-ins')
  .add(
    HttpApiEndpoint.get('overview', '/:merchantSlug/booking/:shopSlug/walk-ins', {
      params: ShopPath,
      success: WalkInOverview,
      error: WalkInHttpErrors
    })
  )
  .add(
    HttpApiEndpoint.post('enroll', '/:merchantSlug/booking/:shopSlug/walk-ins', {
      params: ShopPath,
      payload: WalkInEnrollmentPayload,
      success: WalkInEnrollmentResponse,
      error: WalkInHttpErrors
    })
  )
  .add(
    HttpApiEndpoint.get(
      'inspect',
      '/:merchantSlug/booking/:shopSlug/walk-ins/:entryId',
      { params: EntryPath, success: WalkInQueueEntry, error: WalkInHttpErrors }
    )
  )

export const WalkInHttpApi = HttpApi.make('walk-in-enrollment').add(WalkInHttpGroup)
