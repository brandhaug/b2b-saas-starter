import type { ReactNode } from 'react'
import { useMobileCalendarDate } from '@/features/appointments/mobile/use-mobile-calendar-date.ts'
import { MerchantHomeAtmosphere } from '../home-atmosphere.tsx'
import { MobileHomeActions } from './mobile-home-actions.tsx'

export function MobileHomeLayout({
  appointmentDate,
  timezone,
  children
}: {
  readonly appointmentDate: string
  readonly timezone: string
  readonly children: ReactNode
}) {
  const currentDate = useMobileCalendarDate(timezone)

  return (
    <main
      data-mobile-home-viewport="true"
      className="merchant-mobile merchant-mobile-home relative h-dvh min-h-dvh overflow-hidden text-foreground"
    >
      <MerchantHomeAtmosphere showHero={false} />
      <section
        data-mobile-home-content="true"
        className="merchant-safe-area-inline relative z-10 flex h-full min-h-0 min-w-0 flex-col px-5 pt-[calc(env(safe-area-inset-top)+2rem)]"
      >
        {children}
      </section>
      <MobileHomeActions appointmentDate={appointmentDate} currentDate={currentDate} />
    </main>
  )
}
