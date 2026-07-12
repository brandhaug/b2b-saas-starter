import { Schema } from 'effect'
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'
import { WalkInEnrollment } from '@b2b-saas-starter/capabilities/walk-ins'

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

export const WalkInHttpGroup = HttpApiGroup.make('walk-ins')
  .add(
    HttpApiEndpoint.get('overview', '/:merchantSlug/booking/:shopSlug/walk-ins', {
      params: ShopPath,
      success: Schema.Unknown
    })
  )
  .add(
    HttpApiEndpoint.post('enroll', '/:merchantSlug/booking/:shopSlug/walk-ins', {
      params: ShopPath,
      payload: WalkInEnrollmentPayload,
      success: Schema.Unknown
    })
  )
  .add(
    HttpApiEndpoint.get(
      'inspect',
      '/:merchantSlug/booking/:shopSlug/walk-ins/:entryId',
      { params: EntryPath, success: Schema.Unknown }
    )
  )

export const WalkInHttpApi = HttpApi.make('walk-in-enrollment').add(WalkInHttpGroup)
