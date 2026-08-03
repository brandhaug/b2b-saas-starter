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

export class AppointmentCalendarExportNotFound extends Schema.TaggedErrorClass<AppointmentCalendarExportNotFound>()(
  'AppointmentCalendarExportNotFound',
  {},
  { httpApiStatus: 404 }
) {}

export class AppointmentCalendarExportUnavailable extends Schema.TaggedErrorClass<AppointmentCalendarExportUnavailable>()(
  'AppointmentCalendarExportUnavailable',
  {},
  { httpApiStatus: 503 }
) {}

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
      error: [AppointmentCalendarExportNotFound, AppointmentCalendarExportUnavailable]
    }
  )
)

export const BookingConfirmationHttpApi = HttpApi.make('booking-confirmation-api').add(
  BookingConfirmationHttpGroup
)
