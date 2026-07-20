import type { ProviderCalendar } from '@b2b-saas-starter/capabilities/booking'
import { decodeAppointmentCalendarSearch } from '../appointment-calendar-date.ts'
import { getAppointmentCalendar } from './appointment-operations.ts'
import { requireMerchantSession } from './merchant-session.ts'

const merchantSurfacePaths = new Set([
  '/appointments',
  '/walk-ins',
  '/customers',
  '/services',
  '/providers',
  '/availability',
  '/settings'
])

export async function loadDesktopWorkspaceCalendar({
  pathname,
  href,
  searchStr
}: {
  readonly pathname: string
  readonly href: string
  readonly searchStr: string
}): Promise<ProviderCalendar | null> {
  if (!isMerchantSurface(pathname)) return null

  const search = decodeAppointmentCalendarSearch({
    date: new URLSearchParams(searchStr).get('date') ?? undefined
  })
  await requireMerchantSession(href)
  return getAppointmentCalendar({ data: search })
}

function isMerchantSurface(pathname: string): boolean {
  return merchantSurfacePaths.has(pathname) || pathname.startsWith('/appointments/')
}
