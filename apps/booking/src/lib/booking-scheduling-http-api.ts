import { Schema } from 'effect'
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema
} from 'effect/unstable/httpapi'
import {
  BookingAvailability,
  BookingSchedulingRecovery,
  CapabilityUnavailable,
  HoldTimeSlotInput,
  TimeSlotHold
} from '@b2b-saas-starter/capabilities'

export const BookingSchedulingPath = Schema.Struct({
  merchantSlug: Schema.String,
  sessionId: Schema.String
})

export const BookingAvailabilityQuery = Schema.Struct({
  from: Schema.optionalKey(Schema.String),
  days: Schema.optionalKey(Schema.String)
})

const BookingSchedulingHttpError = BookingSchedulingRecovery.pipe(
  HttpApiSchema.status(409)
)

export const BookingSchedulingHttpGroup = HttpApiGroup.make('booking-scheduling')
  .add(
    HttpApiEndpoint.get(
      'availability',
      '/:merchantSlug/booking/session/:sessionId/availability',
      {
        params: BookingSchedulingPath,
        query: BookingAvailabilityQuery,
        success: BookingAvailability,
        error: [BookingSchedulingHttpError, CapabilityUnavailable]
      }
    )
  )
  .add(
    HttpApiEndpoint.post('hold', '/:merchantSlug/booking/session/:sessionId/hold', {
      params: BookingSchedulingPath,
      payload: HoldTimeSlotInput,
      success: TimeSlotHold,
      error: [BookingSchedulingHttpError, CapabilityUnavailable]
    })
  )

export const BookingSessionHttpApi = HttpApi.make('booking-session').add(
  BookingSchedulingHttpGroup
)
