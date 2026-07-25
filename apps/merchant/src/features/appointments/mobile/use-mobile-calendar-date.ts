import { useEffect, useState } from 'react'
import {
  mobileCalendarDate,
  mobileCalendarDateRefreshDelay
} from './mobile-appointments-model.ts'

const startMobileCalendarDateRefresh = (
  timezone: string,
  updateDate: (date: string) => void
): (() => void) => {
  let timeout: ReturnType<typeof setTimeout>

  const refresh = () => {
    const now = new Date()
    updateDate(mobileCalendarDate(timezone, now))
    timeout = setTimeout(refresh, mobileCalendarDateRefreshDelay(timezone, now) + 1_000)
  }

  refresh()
  return () => clearTimeout(timeout)
}

export function useMobileCalendarDate(timezone: string): string {
  const [currentDate, setCurrentDate] = useState(() => mobileCalendarDate(timezone))

  useEffect(() => startMobileCalendarDateRefresh(timezone, setCurrentDate), [timezone])

  return currentDate
}
