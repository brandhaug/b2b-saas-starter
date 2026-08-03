import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import {
  MerchantPresentationBoundary,
  MerchantShell
} from '@/components/merchant-shell/index.ts'
import { DesktopAppointmentDetailScreen } from '@/features/appointments/desktop/desktop-appointment-detail-screen.tsx'
import { MobileAppointmentDetailScreen } from '@/features/appointments/mobile/mobile-appointment-detail-screen.tsx'
import { cachedAppointmentDetail } from '@/features/appointments/shared/cached-appointment-detail.ts'
import { merchantPublicBookingUrlQuery } from '@/lib/merchant-home-queries.ts'
import { getAppointmentDetail } from '@/lib/server/appointment-operations.ts'
import { requireMerchantSession } from '@/lib/server/merchant-session.ts'

export const Route = createFileRoute('/appointments/$appointmentId')({
  beforeLoad: async ({ context, location, params }) => {
    const cached = cachedAppointmentDetail(context.queryClient, params.appointmentId)
    if (!cached) await requireMerchantSession(location.href)
  },
  component: AppointmentDetailPage
})

function AppointmentDetailPage() {
  const { appointmentId } = Route.useParams()
  const queryClient = useQueryClient()
  const cached = cachedAppointmentDetail(queryClient, appointmentId)
  const detail = useQuery({
    queryKey: ['appointment-detail', appointmentId],
    queryFn: () => getAppointmentDetail({ data: { appointmentId } }),
    retry: false,
    staleTime: 30_000
  })
  const bookingUrl = useQuery(merchantPublicBookingUrlQuery())
  const authorizedAppointment =
    detail.data?.kind === 'found' ? detail.data.appointment : undefined
  const appointment = authorizedAppointment ?? cached

  return (
    <MerchantShell
      section={{ kind: 'merchant' }}
      title="Appointment detail"
      description="An inspect-only record of the facts accepted when this Appointment was confirmed."
      layout="task"
    >
      <MerchantPresentationBoundary
        desktop={
          authorizedAppointment ? (
            <DesktopAppointmentDetailScreen appointment={authorizedAppointment} />
          ) : (
            <AppointmentDetailState
              failed={detail.isError || detail.data?.kind === 'not_found'}
            />
          )
        }
        mobile={
          appointment ? (
            <MobileAppointmentDetailScreen
              appointment={appointment}
              bookingUrl={bookingUrl.data ?? undefined}
              contactActionsEnabled={authorizedAppointment !== undefined}
            />
          ) : (
            <AppointmentDetailState
              failed={detail.isError || detail.data?.kind === 'not_found'}
            />
          )
        }
      />
    </MerchantShell>
  )
}

function AppointmentDetailState({ failed }: { readonly failed: boolean }) {
  return (
    <div className="grid min-h-48 place-items-center px-6 text-center">
      <p className="text-sm font-medium text-muted-foreground">
        {failed ? 'This appointment could not be loaded.' : 'Loading appointment…'}
      </p>
    </div>
  )
}
