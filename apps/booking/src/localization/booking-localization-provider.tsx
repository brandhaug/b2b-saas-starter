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
  BOOKING_LANGUAGE_NAMES,
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
import { BookingVisualAsset } from '../assets/booking-visual-asset.tsx'

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
  },
  toolbar: {
    position: 'fixed',
    top: `max(${bookingTheme.space5}, env(safe-area-inset-top))`,
    right: 'max(16px, calc((100vw - 375px) / 2 + 16px))',
    zIndex: bookingTheme.layerPromotion,
    display: 'block'
  },
  toolbarSelect: {
    minHeight: 42,
    paddingInline: bookingTheme.space3,
    backgroundColor: bookingTheme.colorSurface
  },
  toolbarButton: {
    display: 'grid',
    width: 32,
    height: 32,
    marginLeft: 'auto',
    placeItems: 'center',
    padding: 0,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: bookingTheme.colorCartAuxBorderLight,
    borderRadius: bookingTheme.radiusRound,
    backgroundColor: 'transparent',
    color: bookingTheme.colorText
  },
  toolbarPanel: {
    position: 'absolute',
    top: 40,
    right: 0,
    width: 154,
    padding: bookingTheme.space3,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: bookingTheme.colorBorder,
    borderRadius: bookingTheme.radiusMedium,
    backgroundColor: bookingTheme.whiteA100,
    boxShadow: bookingTheme.shadowSheet
  },
  toolbarIcon: { width: 10, height: 10 }
})

export function BookingLanguagePicker({
  label,
  placement = 'inline'
}: {
  readonly label: string
  readonly placement?: 'inline' | 'toolbar' | 'title'
}) {
  const { locale, setLocale } = useBookingLocalization()
  const [open, setOpen] = useState(false)
  if (placement === 'toolbar' || placement === 'title') {
    const controls = (
      <>
        <button
          type="button"
          aria-label="Booking menu"
          aria-expanded={open}
          data-testid="btn:menu"
          onClick={() => setOpen((value) => !value)}
          {...stylex.props(styles.toolbarButton)}
        >
          <BookingVisualAsset
            assetRole="navigation-menu"
            {...stylex.props(styles.toolbarIcon)}
          />
        </button>
        {open ? (
          <label {...stylex.props(styles.label, styles.toolbarPanel)}>
            <span>{label}</span>
            <select
              value={locale}
              onChange={(event) =>
                setLocale(event.currentTarget.value as BookingLocale)
              }
              {...stylex.props(styles.select, styles.toolbarSelect)}
            >
              {BOOKING_LOCALES.map((value) => (
                <option key={value} value={value}>
                  {BOOKING_LANGUAGE_NAMES[value]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </>
    )
    return placement === 'title' ? (
      controls
    ) : (
      <div {...stylex.props(styles.toolbar)}>{controls}</div>
    )
  }
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
            {BOOKING_LANGUAGE_NAMES[value]}
          </option>
        ))}
      </select>
    </label>
  )
}
