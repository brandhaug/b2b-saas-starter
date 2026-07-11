import * as stylex from '@stylexjs/stylex'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import {
  BOOKING_LOCALES,
  formatBookingCurrency,
  formatBookingDate,
  formatBookingPhone,
  formatBookingTime,
  parseBookingLocale,
  persistBookingLocale,
  readPersistedBookingLocale,
  resolveBookingLocale,
  translateBookingError,
  translateBookingMessage,
  type BookingErrorCode,
  type BookingLocale,
  type BookingTranslationKey
} from './booking-localization.ts'
import { bookingTheme } from '../presentation/booking-theme.stylex.ts'

type BookingLocalization = {
  readonly locale: BookingLocale
  readonly setLocale: (locale: BookingLocale) => void
  readonly message: (key: BookingTranslationKey) => string
  readonly error: (code: BookingErrorCode) => string
  readonly date: (instant: string | Date, timeZone: string) => string
  readonly time: (instant: string | Date, timeZone: string) => string
  readonly currency: (amountMinor: number, currency: string) => string
  readonly phone: (
    e164: string,
    country: Parameters<typeof formatBookingPhone>[1]
  ) => string
}

const BookingLocalizationContext = createContext<BookingLocalization | null>(null)

export function BookingLocalizationProvider({
  sessionLocale,
  onLocaleChange,
  onUnknownErrorCode,
  children
}: {
  readonly sessionLocale?: string | null
  readonly onLocaleChange?: (locale: BookingLocale) => void
  readonly onUnknownErrorCode?: (code: string) => void
  readonly children: ReactNode
}) {
  const initialLocale = resolveBookingLocale({ sessionLocale })
  const [locale, setLocaleState] = useState<BookingLocale>(initialLocale)

  useEffect(() => {
    const resolvedLocale = parseBookingLocale(sessionLocale)
      ? initialLocale
      : resolveBookingLocale({
          persistedLocale: readPersistedBookingLocale(window.localStorage),
          acceptedLanguages: [...navigator.languages, navigator.language]
        })
    document.documentElement.lang = resolvedLocale
    setLocaleState(resolvedLocale)
  }, [initialLocale, sessionLocale])

  const setLocale = useCallback(
    (nextLocale: BookingLocale) => {
      setLocaleState(nextLocale)
      document.documentElement.lang = nextLocale
      persistBookingLocale(nextLocale, window.localStorage)
      onLocaleChange?.(nextLocale)
    },
    [onLocaleChange]
  )

  const value = useMemo<BookingLocalization>(
    () => ({
      locale,
      setLocale,
      message: (key) => translateBookingMessage(locale, key),
      error: (code) =>
        onUnknownErrorCode
          ? translateBookingError(locale, code, onUnknownErrorCode)
          : translateBookingError(locale, code),
      date: (instant, timeZone) => formatBookingDate(locale, instant, timeZone),
      time: (instant, timeZone) => formatBookingTime(locale, instant, timeZone),
      currency: (amountMinor, currency) =>
        formatBookingCurrency(locale, amountMinor, currency),
      phone: (e164, country) => formatBookingPhone(e164, country)
    }),
    [locale, onUnknownErrorCode, setLocale]
  )

  return (
    <BookingLocalizationContext.Provider value={value}>
      {children}
    </BookingLocalizationContext.Provider>
  )
}

export function useBookingLocalization() {
  const value = useContext(BookingLocalizationContext)
  if (!value) {
    throw new Error(
      'useBookingLocalization must be used within BookingLocalizationProvider'
    )
  }
  return value
}

const languageNames: Record<BookingLocale, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  ro: 'Română'
}

const styles = stylex.create({
  label: {
    display: 'grid',
    gap: bookingTheme.space1,
    fontSize: bookingTheme.textFootnote,
    fontWeight: bookingTheme.fontWeightSemibold
  },
  select: {
    minHeight: bookingTheme.targetMinimum,
    paddingInline: bookingTheme.space3,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: bookingTheme.colorBorder,
    borderRadius: bookingTheme.radiusMedium,
    backgroundColor: bookingTheme.colorSurface,
    color: bookingTheme.colorText,
    fontSize: bookingTheme.textInput
  }
})

export function BookingLanguagePicker({ label }: { readonly label: string }) {
  const { locale, setLocale } = useBookingLocalization()
  return (
    <label {...stylex.props(styles.label)}>
      <span>{label}</span>
      <select
        value={locale}
        onChange={(event) => setLocale(event.currentTarget.value as BookingLocale)}
        {...stylex.props(styles.select)}
      >
        {BOOKING_LOCALES.map((value) => (
          <option key={value} value={value}>
            {languageNames[value]}
          </option>
        ))}
      </select>
    </label>
  )
}
