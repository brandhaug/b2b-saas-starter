import { useEffect, useState } from 'react'
import {
  mobileCalendarDate,
  mobileCalendarDateRefreshDelay
} from './mobile-appointments-model.ts'

export function useMobileCalendarDate(timezone: string): string {
  const [currentDate, setCurrentDate] = useState(() => mobileCalendarDate(timezone))

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>

    const refresh = () => {
      const now = new Date()
      setCurrentDate(mobileCalendarDate(timezone, now))
      timeout = setTimeout(
        refresh,
        mobileCalendarDateRefreshDelay(timezone, now) + 1_000
      )
    }

    refresh()
    return () => clearTimeout(timeout)
  }, [timezone])

  return currentDate
}
