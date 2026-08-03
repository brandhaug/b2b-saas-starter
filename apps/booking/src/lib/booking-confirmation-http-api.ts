import { Schema } from 'effect'
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema
} from 'effect/unstable/httpapi'

export const AppointmentCalendarExportPath = Schema.Struct({
  merchantSlug: Schema.String,
  routeId: Schema.String,
  appointmentId: Schema.String
})

export const AppointmentCalendarExportNotFound = Schema.String.pipe(
  HttpApiSchema.asText({ contentType: 'text/plain; charset=utf-8' }),
  HttpApiSchema.status(404)
)

export const AppointmentCalendarExportRateLimited = Schema.String.pipe(
  HttpApiSchema.asText({ contentType: 'text/plain; charset=utf-8' }),
  HttpApiSchema.status(429)
)

export const AppointmentCalendarExportUnavailable = Schema.String.pipe(
  HttpApiSchema.asText({ contentType: 'text/plain; charset=utf-8' }),
  HttpApiSchema.status(503)
)

export const BookingConfirmationHttpGroup = HttpApiGroup.make(
  'booking-confirmation'
).add(
  HttpApiEndpoint.get(
    'appointmentCalendarExport',
    '/:merchantSlug/booking/confirmations/:routeId/appointments/:appointmentId/calendar.ics',
    {
      params: AppointmentCalendarExportPath,
      success: Schema.String.pipe(
        HttpApiSchema.asText({ contentType: 'text/calendar; charset=utf-8' })
      ),
      error: [
        AppointmentCalendarExportNotFound,
        AppointmentCalendarExportRateLimited,
        AppointmentCalendarExportUnavailable
      ]
    }
  )
)

export const BookingConfirmationHttpApi = HttpApi.make('booking-confirmation-api').add(
  BookingConfirmationHttpGroup
)
