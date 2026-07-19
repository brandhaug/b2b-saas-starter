export const BOOKING_PROCESSING_SUCCESS_STATE = 'bookingProcessingSuccess'

export interface BookingProcessingSuccessState {
  readonly expiresAt: number
  readonly label: string
}

type ConfirmationAccessFetcher = (
  input: string,
  init: RequestInit
) => Promise<Pick<Response, 'ok' | 'url'>>

export const exchangeBookingConfirmationAccess = async (
  location: string,
  fetchConfirmation: ConfirmationAccessFetcher = fetch
) => {
  if (typeof window === 'undefined') return null
  const requested = new URL(location, window.location.href)
  const response = await fetchConfirmation(location, { credentials: 'same-origin' })
  if (!response.ok) return null
  const settled = new URL(response.url || location, requested)
  if (
    settled.origin !== requested.origin ||
    settled.pathname !== requested.pathname ||
    settled.searchParams.has('token')
  )
    return null
  return `${settled.pathname}${settled.search}${settled.hash}`
}

const historyRecord = () => {
  if (typeof window === 'undefined') return {}
  const state: unknown = window.history.state
  return state && typeof state === 'object' ? (state as Record<string, unknown>) : {}
}

export const readBookingProcessingSuccess = (
  now = Date.now()
): BookingProcessingSuccessState | null => {
  const candidate = historyRecord()[BOOKING_PROCESSING_SUCCESS_STATE]
  if (!candidate || typeof candidate !== 'object') return null
  const { expiresAt, label } = candidate as Record<string, unknown>
  if (
    typeof expiresAt !== 'number' ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= now ||
    typeof label !== 'string' ||
    label.length === 0
  )
    return null
  return { expiresAt, label }
}

export const clearBookingProcessingSuccess = () => {
  if (typeof window === 'undefined') return
  const state = { ...historyRecord() }
  delete state[BOOKING_PROCESSING_SUCCESS_STATE]
  window.history.replaceState(state, '', window.location.href)
}

export const replaceWithBookingSuccess = (
  location: string,
  label: string,
  duration = 3000
) => {
  if (typeof window === 'undefined') return
  const state = {
    ...historyRecord(),
    [BOOKING_PROCESSING_SUCCESS_STATE]: {
      expiresAt: Date.now() + duration,
      label
    } satisfies BookingProcessingSuccessState
  }
  window.history.replaceState(state, '', new URL(location, window.location.href))
}
